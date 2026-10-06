import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { Pool } from 'pg'

import { startWebDriver, type WebDriver } from '../helpers/web-driver'

/**
 * Parity P-C against the real Postgres stack (in-process server):
 *   - W7a HPO search from the bundled ontology,
 *   - W7b gene-list validation, panel BED download, cohort query with an
 *     active gene panel (P-06: the web gene-reference loader, not a stub that throws),
 *   - W7c external-lookup egress policy (default off, admin-enabled, audited),
 *   - W13 cohort association on Postgres.
 *
 * The built web bundle aliases the desktop gene-reference loader to the web
 * loader (vite.web.config.ts WEB_STUBS); the in-process server here imports
 * source, so the same alias is applied with vi.mock.
 */
vi.mock('../../../src/main/database/geneReferenceLoader', async () => {
  return await import('../../../src/web/stubs/gene-reference-loader-stub')
})

const PG_URL = process.env.VARLENS_PG_URL ?? ''
const HAS_PG = PG_URL !== ''

let driver: WebDriver
let pool: Pool
const realFetch = globalThis.fetch

async function seedCase(name: string, variants: Array<[string, number, string, string]>) {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO "${driver.schema}".cases (name, file_path, file_size, created_at, variant_count)
       VALUES ($1, '/tmp/seed.vcf', 0, 0, $2) RETURNING id`,
    [name, variants.length]
  )
  const caseId = Number(res.rows[0].id)
  for (const [chr, pos, gene, gt] of variants) {
    await pool.query(
      `INSERT INTO "${driver.schema}".variants
         (case_id, chr, pos, ref, alt, variant_type, gt_num, gene_symbol, consequence)
       VALUES ($1, $2, $3, 'A', 'T', 'snv', $4, $5, 'HIGH')`,
      [caseId, chr, pos, gt, gene]
    )
  }
  return caseId
}

describe.skipIf(!HAS_PG)('parity P-C reference services (web/Postgres)', () => {
  beforeAll(async () => {
    driver = await startWebDriver()
    pool = new Pool({ connectionString: PG_URL, max: 2 })
  }, 60_000)

  afterAll(async () => {
    await pool?.end()
    await driver?.close()
  })

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  test('hpo:search answers from the bundled ontology', async () => {
    const res = await driver.api('hpo', 'search', 'Seizure', 5)
    expect(res.statusCode, res.body).toBe(200)
    const body = res.json() as { success: boolean; terms: Array<{ id: string }> }
    expect(body.success).toBe(true)
    expect(body.terms[0].id).toBe('HP:0001250')
  })

  test('gene-list setGenes rejects NOTAGENE1 and keeps valid lists', async () => {
    const list = (await driver.api('geneLists', 'create', 'P-C list')).json() as { id: number }
    const bad = await driver.api('geneLists', 'setGenes', list.id, ['BRCA1', 'NOTAGENE1'])
    expect(bad.statusCode).toBe(400)
    expect((bad.json() as { userMessage: string }).userMessage).toContain('NOTAGENE1')
    const ok = await driver.api('geneLists', 'setGenes', list.id, ['BRCA1', 'TP53'])
    expect(ok.statusCode, ok.body).toBe(200)
    expect(ok.json()).toEqual(expect.arrayContaining(['BRCA1', 'TP53']))
  })

  test('panel BED download and cohort query with an active panel', async () => {
    const created = await driver.api('panels', 'create', { name: 'BRCA panel' })
    expect(created.statusCode, created.body).toBe(200)
    const panel = created.json() as { id: number }
    const set = await driver.api('panels', 'setGenes', panel.id, [
      { hgncId: 'HGNC:1100', symbol: 'BRCA1' }
    ])
    expect(set.statusCode, set.body).toBe(200)

    // panels.exportBed uses P-D's signed single-use download grant.
    const prepared = await driver.api('export', 'prepareDownload', {
      kind: 'panel-bed',
      panelId: panel.id,
      assembly: 'GRCh38',
      paddingBp: 0
    })
    expect(prepared.statusCode, prepared.body).toBe(200)
    const bed = await driver.app.inject({
      method: 'GET',
      url: `/api/${(prepared.json() as { downloadPath: string }).downloadPath}`,
      headers: { cookie: driver.cookie }
    })
    expect(bed.statusCode, bed.body).toBe(200)
    expect(bed.headers['content-disposition']).toContain('BRCA_panel_GRCh38.bed')
    expect(bed.body).toMatch(/\nchr17\t\d+\t\d+\tBRCA1\n/)

    await seedCase('panel-case', [
      ['chr17', 43_050_000, 'BRCA1', '0/1'],
      ['chr1', 1_000_000, 'OTHER', '0/1']
    ])
    const cohort = await driver.api('cohort', 'getVariants', {
      active_panel_ids: [panel.id],
      limit: 50,
      offset: 0
    })
    expect(cohort.statusCode, cohort.body).toBe(200)
    const rows = (cohort.json() as { data: Array<{ gene_symbol: string }> }).data
    expect(rows.map((r) => r.gene_symbol)).toEqual(['BRCA1'])
  })

  test('external lookups: off by default, refused without a request, admin-enabled, audited', async () => {
    const fetchSpy = vi.fn(async () => new Response('[]', { status: 200 }))
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    const status = (await driver.api('referenceServices', 'status')).json() as {
      services: Array<{ id: string; enabled: boolean }>
    }
    expect(status.services.every((s) => !s.enabled)).toBe(true)

    const refused = await driver.api('vep', 'fetch', 'chr17', 43_050_000, 'A', 'T')
    expect(refused.statusCode).toBe(403)
    expect((refused.json() as { userMessage: string }).userMessage).toMatch(/turned off/)
    expect(fetchSpy).not.toHaveBeenCalled()

    const enable = await driver.api('referenceServices', 'setPolicy', { vep: true })
    expect(enable.statusCode, enable.body).toBe(200)
    const stored = await pool.query<{ value: string }>(
      `SELECT value FROM "${driver.schema}".database_settings WHERE key = 'external_lookups'`
    )
    expect(JSON.parse(stored.rows[0].value).services.vep).toBe(true)

    const allowed = await driver.api('vep', 'fetch', 'chr17', 43_050_001, 'A', 'T')
    expect(allowed.statusCode, allowed.body).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    const audit = await pool.query<{ user_name: string; new_value: string }>(
      `SELECT user_name, new_value FROM varlens_audit.audit_log
        WHERE project_schema = $1 AND entity_key = 'external-lookup:vep' ORDER BY id`,
      [driver.schema]
    )
    const values = audit.rows.map((row) => ({
      user: row.user_name,
      ...(JSON.parse(row.new_value) as { identifier: string; outcome: string })
    }))
    expect(values).toEqual([
      expect.objectContaining({
        user: 'web-gate-admin',
        identifier: 'chr17:43050000:A>T',
        outcome: 'blocked'
      }),
      expect.objectContaining({
        user: 'web-gate-admin',
        identifier: 'chr17:43050001:A>T',
        outcome: 'allowed'
      })
    ])
  })

  test('cohort association runs on Postgres', async () => {
    const a1 = await seedCase('assoc-a1', [['chr2', 100, 'GENEX', '0/1']])
    const a2 = await seedCase('assoc-a2', [['chr2', 100, 'GENEX', '1/1']])
    const b1 = await seedCase('assoc-b1', [['chr3', 200, 'GENEY', '0/1']])
    const b2 = await seedCase('assoc-b2', [['chr3', 300, 'GENEY', '0/1']])

    const res = await driver.api('cohort', 'runAssociation', {
      groupA_ids: [a1, a2],
      groupB_ids: [b1, b2],
      primary_test: 'fisher',
      weight_scheme: 'uniform',
      covariates: ['sex'],
      filters: { consequences: ['HIGH'] },
      max_threads: 2
    })
    expect(res.statusCode, res.body).toBe(200)
    const body = res.json() as {
      results: Array<{ gene_symbol: string; groupA_carriers: number; groupB_carriers: number }>
    }
    const byGene = Object.fromEntries(body.results.map((r) => [r.gene_symbol, r]))
    expect(byGene.GENEX).toMatchObject({ groupA_carriers: 2, groupB_carriers: 0 })
    expect(byGene.GENEY).toMatchObject({ groupA_carriers: 0, groupB_carriers: 2 })

    const cancel = await driver.api('cohort', 'cancelAssociation')
    expect(cancel.statusCode).toBe(200)
  })
})
