// @vitest-environment node
/**
 * VCF FORMAT PS is stored as `variants.ps` (#586) by the SQLite importer and
 * written unchanged by the PostgreSQL COPY path (the PostgreSQL part is gated
 * by VARLENS_RUN_POSTGRES_E2E=1). Fixture: synthetic-phased.vcf (synthetic).
 */
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'

import { Client, Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { DatabaseService } from '../../../../src/main/database'
import { prepareStatements, streamInsertVcf } from '../../../../src/main/workers/import-pipeline'
import { POSTGRES_MIGRATIONS } from '../../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { VARIANT_BASE_COLUMNS } from '../../../../src/main/storage/postgres/postgres-import-columns'
import { PostgresVcfImportRepository } from '../../../../src/main/storage/postgres/PostgresVcfImportRepository'

const VCF = resolve(__dirname, '../../../test-data/vcf/synthetic-phased.vcf')
const RUN_PG = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

/** Every row of the fixture: phased calls keep their PS; a split 1|2 keeps it on both ALTs. */
const EXPECTED = [
  'chr1:1000>G 0|1 1000',
  'chr1:2000>T 1|0 1000',
  'chr1:3000>A 1|. 3000',
  'chr1:3000>C .|1 3000',
  'chr1:4000>C 0|1 null',
  'chr1:5000>T 0/1 null'
]

const describeRow = (r: { chr: string; pos: number; alt: string; gt_num: string; ps: unknown }) =>
  `${r.chr}:${r.pos}>${r.alt} ${r.gt_num} ${r.ps === null ? 'null' : Number(r.ps)}`

async function importSqlite(): Promise<{ service: DatabaseService; caseId: number }> {
  const service = new DatabaseService(':memory:')
  const caseId = service.cases.createCase('S1', VCF, 1000)
  await streamInsertVcf(
    VCF,
    { format: 'vcf', caseKey: '' },
    caseId,
    1000,
    prepareStatements(service.database),
    () => false,
    ['S1'],
    () => {}
  )
  return { service, caseId }
}

describe('VCF phase set import (#586)', () => {
  it('stores FORMAT PS in variants.ps on SQLite', async () => {
    const { service, caseId } = await importSqlite()
    try {
      const rows = service.database
        .prepare(
          'SELECT chr, pos, alt, gt_num, ps FROM variants WHERE case_id = ? ORDER BY pos, alt'
        )
        .all(caseId) as Array<{
        chr: string
        pos: number
        alt: string
        gt_num: string
        ps: unknown
      }>
      expect(rows.map(describeRow)).toEqual(EXPECTED)
    } finally {
      service.close()
    }
  })

  it('attaches comphet_phase on case page reads when consider_phasing is true (#630)', async () => {
    const { service, caseId } = await importSqlite()
    try {
      const page = service.variants.getVariants(
        {
          case_id: caseId,
          inheritance_modes: ['candidate_compound_het'],
          consider_phasing: true
        },
        50,
        0
      )
      const byGene = Object.fromEntries(page.data.map((r) => [r.gene_symbol, r.comphet_phase]))
      expect(byGene).toEqual({
        GENEA: 'trans',
        GENEB: 'trans',
        GENEC: 'possible'
      })
      expect(page.data.map((r) => `${r.gene_symbol}:${r.comphet_phase}`)).toEqual([
        'GENEA:trans',
        'GENEA:trans',
        'GENEB:trans',
        'GENEB:trans',
        'GENEC:possible',
        'GENEC:possible'
      ])

      // Regression: a filtered-out common variant in trans must not flip a cis pair to trans on paginated reads
      service.database
        .prepare(
          `INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, gt_num, ps, gnomad_af)
           VALUES (?, 'chr1', 1500, 'A', 'G', 'GENEA', '0|1', 1000, 0.001)`
        )
        .run(caseId)
      service.database
        .prepare(
          'UPDATE variants SET gnomad_af = 0.5 WHERE case_id = ? AND gene_symbol = ? AND pos = ?'
        )
        .run(caseId, 'GENEA', 2000)
      const filteredPage = service.variants.getVariants(
        {
          case_id: caseId,
          gnomad_af_max: 0.01,
          consider_phasing: true
        },
        1,
        0
      )
      expect(filteredPage.data).toHaveLength(1)
      expect(filteredPage.data[0].gene_symbol).toBe('GENEA')
      expect(filteredPage.data[0].comphet_phase).toBe('cis')
    } finally {
      service.close()
    }
  })
})

describe.skipIf(!RUN_PG)('VCF phase set import on PostgreSQL (#586)', () => {
  const schema = `vt_phase_set_${randomBytes(4).toString('hex')}`
  let pool: Pool

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_URL, max: 2 })
    await pool.query(`CREATE SCHEMA "${schema}"`)
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
  }, 180_000)

  afterAll(async () => {
    if (pool) await pool.end()
    const cleaner = new Client({ connectionString: PG_URL })
    await cleaner.connect()
    await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await cleaner.end()
  }, 120_000)

  it('writes the mapped rows with their phase sets through COPY', async () => {
    // The importer's mapped rows, taken from a SQLite import of the same fixture.
    const { service, caseId } = await importSqlite()
    const columns = VARIANT_BASE_COLUMNS.filter((c) => c !== 'case_id')
    const variants = service.database
      .prepare(`SELECT ${columns.join(', ')} FROM variants WHERE case_id = ? ORDER BY pos, alt`)
      .all(caseId) as Array<Record<string, unknown>>
    service.close()

    const client = await pool.connect()
    let pgCaseId: number
    try {
      await client.query('BEGIN')
      const result = await new PostgresVcfImportRepository(schema).writeVcfFile(client as never, {
        mode: 'single-file',
        caseName: 'phased',
        fileName: 'synthetic-phased.vcf',
        filePath: VCF,
        fileSize: 1000,
        genomeBuild: 'GRCh38',
        caller: null,
        annotationFormat: null,
        variantType: 'snv-indel',
        variants: variants as never,
        transcripts: [],
        sv: [],
        cnv: [],
        str: []
      })
      await client.query('COMMIT')
      pgCaseId = result.caseId
    } finally {
      client.release()
    }

    const stored = await pool.query(
      `SELECT chr, pos, alt, gt_num, ps FROM "${schema}".variants WHERE case_id = $1 ORDER BY pos, alt`,
      [pgCaseId]
    )
    expect(stored.rows.map((r) => describeRow({ ...r, pos: Number(r.pos) }))).toEqual(EXPECTED)
  }, 120_000)
})
