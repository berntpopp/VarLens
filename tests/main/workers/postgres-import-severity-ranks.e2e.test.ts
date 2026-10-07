/**
 * The PostgreSQL import pipeline stores `impact_rank` / `clinvar_rank` next to
 * the raw `consequence` (impact) and `clinvar` strings (#469): the COPY path
 * for VCF (VEP CSQ, SnpEff ANN) and the recordset path for JSON.
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires a reachable VARLENS_PG_URL.
 */
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { Client, Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { detectFormat } from '../../../src/main/import/format-detection'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { createMapperPipeline } from '../../../src/main/workers/import-pipeline'
import {
  runImport,
  streamMappedVcfRows,
  type RunImportDeps
} from '../../../src/main/workers/postgres-import-worker'
import { clinvarRank, impactRank } from '../../../src/shared/config/severity.config'
import type { PostgresImportWorkerOutboundMessage } from '../../../src/shared/types/postgres-import-worker'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

const VCF_DIR = resolve(__dirname, '../../test-data/vcf')

interface RankedRow {
  consequence: string | null
  clinvar: string | null
  impact_rank: number
  clinvar_rank: number
}

describe.skipIf(!RUN)('PostgreSQL import stores severity ranks (#469)', () => {
  const schema = `varlens_test_sev_import_${Date.now()}_${randomBytes(4).toString('hex')}`
  let probe: Client
  let dir: string

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-pg-severity-ranks-'))
    probe = new Client({ connectionString: PG_URL })
    await probe.connect()
    await probe.query(`CREATE SCHEMA "${schema}"`)
    const pool = new Pool({ connectionString: PG_URL, max: 2 })
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    await pool.end()
  }, 60_000)

  afterAll(async () => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    if (!probe) return
    await probe.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await probe.end()
  }, 60_000)

  let lastUnranked: string[] | undefined

  async function importFile(
    caseName: string,
    filePath: string,
    selectedSample?: string
  ): Promise<RankedRow[]> {
    const messages: PostgresImportWorkerOutboundMessage[] = []
    const deps: RunImportDeps = {
      createClient: (config) => new Client(config),
      detectFormat,
      createMapperPipeline,
      statFile: (path) => ({ size: statSync(path).size }),
      createVcfMappedStream: async (path, options) =>
        streamMappedVcfRows(path, options.selectedSample, options.filters, options.onSkip)
    }
    await runImport(
      deps,
      {
        type: 'start',
        client: { connectionString: PG_URL },
        schema,
        mode: 'single-file',
        caseName,
        filePath,
        ...(selectedSample !== undefined
          ? { vcfOptions: { selectedSample, genomeBuild: 'GRCh38' } }
          : {}),
        batchSize: 10_000
      },
      (message) => messages.push(message)
    )
    const last = messages.at(-1)
    if (last?.type !== 'complete') throw new Error(`import failed: ${JSON.stringify(last)}`)
    lastUnranked = last.result.unrankedClinvar
    const rows = await probe.query<RankedRow>(
      `SELECT consequence, clinvar, impact_rank, clinvar_rank
         FROM "${schema}".variants WHERE case_id = $1 ORDER BY id`,
      [last.result.caseId]
    )
    return rows.rows
  }

  /** Every stored rank is the configured rank of the stored string. */
  function expectRanksMatchStrings(rows: RankedRow[]): void {
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row, JSON.stringify(row)).toMatchObject({
        impact_rank: impactRank(row.consequence),
        clinvar_rank: clinvarRank(row.clinvar)
      })
    }
  }

  const rankedLevels = (rows: RankedRow[]): number =>
    new Set(rows.map((row) => row.impact_rank).filter((rank) => rank > 0)).size

  it.each([
    ['VEP CSQ', 'single-sample.vep.vcf.gz'],
    ['SnpEff ANN', 'single-sample.snpeff.vcf.gz'],
    ['CSQ, ANN and INFO ClinVar', 'synthetic-unit-test.vcf']
  ])(
    'VCF COPY path: %s',
    async (label, file) => {
      const rows = await importFile(`ranks ${label}`, resolve(VCF_DIR, file), 'HG005')
      expectRanksMatchStrings(rows)
      expect(rankedLevels(rows)).toBeGreaterThan(1)
      if (file === 'synthetic-unit-test.vcf') {
        expect(rows.map((row) => row.clinvar_rank)).toContain(clinvarRank('Likely_pathogenic'))
      }
    },
    120_000
  )

  it('JSON recordset path', async () => {
    const annotations = [
      { consequence: 'HIGH', clinvar: 'Pathogenic' },
      { consequence: 'MODERATE', clinvar: 'Pathogenic/Likely_pathogenic' },
      { consequence: 'LOW', clinvar: 'Conflicting_interpretations_of_pathogenicity' },
      { consequence: 'MODIFIER', clinvar: 'uncertain_significance&likely_benign' },
      { consequence: null, clinvar: null }
    ]
    const file = join(dir, 'ranks.json')
    writeFileSync(
      file,
      JSON.stringify({
        variants: annotations.map((annotation, index) => ({
          chr: 'chr1',
          pos: 100 + index,
          ref: 'A',
          alt: 'G',
          gene_symbol: 'GENE',
          gt_num: '0/1',
          func: 'missense_variant',
          ...annotation
        }))
      })
    )

    expect(await importFile('ranks json', file)).toEqual([
      { consequence: 'HIGH', clinvar: 'Pathogenic', impact_rank: 4, clinvar_rank: 15 },
      {
        consequence: 'MODERATE',
        clinvar: 'Pathogenic/Likely_pathogenic',
        impact_rank: 3,
        clinvar_rank: 14
      },
      {
        consequence: 'LOW',
        clinvar: 'Conflicting_interpretations_of_pathogenicity',
        impact_rank: 2,
        clinvar_rank: 12
      },
      {
        consequence: 'MODIFIER',
        clinvar: 'uncertain_significance&likely_benign',
        impact_rank: 1,
        clinvar_rank: 11
      },
      { consequence: null, clinvar: null, impact_rank: 0, clinvar_rank: 0 }
    ])
  }, 120_000)

  it('returns the ClinVar strings it could not rank with the import result', async () => {
    const file = join(dir, 'odd.json')
    writeFileSync(
      file,
      JSON.stringify({
        variants: ['Pathogenic', 'totally_made_up_term', 'totally_made_up_term', 'LB'].map(
          (clinvar, index) => ({
            chr: 'chr2',
            pos: 100 + index,
            ref: 'A',
            alt: 'G',
            gt_num: '0/1',
            consequence: 'HIGH',
            clinvar
          })
        )
      })
    )
    await importFile('ranks odd', file)
    expect(lastUnranked).toEqual(['totally_made_up_term'])

    // The next import starts clean: nothing is carried over.
    writeFileSync(
      file,
      JSON.stringify({
        variants: [{ chr: 'chr2', pos: 1, ref: 'A', alt: 'G', gt_num: '0/1', clinvar: 'Benign' }]
      })
    )
    await importFile('ranks recognised', file)
    expect(lastUnranked).toBeUndefined()
  }, 120_000)
})
