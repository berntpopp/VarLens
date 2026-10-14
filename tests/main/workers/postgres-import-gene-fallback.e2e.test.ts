/**
 * The PostgreSQL import worker, with its default VCF stream and the gene
 * reference path it receives as workerData, stores the fallback gene of
 * unannotated STR and CNV rows and keeps annotated genes.
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires a reachable VARLENS_PG_URL.
 */
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'

import { Client, Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import type { PostgresImportWorkerOutboundMessage } from '../../../src/shared/types/postgres-import-worker'

vi.mock('node:worker_threads', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  workerData: { geneRefDbPath: resolve(__dirname, '../../../resources/gene_reference.db') }
}))

const { defaultDeps, runImport } = await import('../../../src/main/workers/postgres-import-worker')

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'
const VCF_DIR = resolve(__dirname, '../../test-data/vcf')

describe.skipIf(!RUN)('PostgreSQL import fills genes of unannotated SV/CNV/STR rows', () => {
  const schema = `varlens_test_gene_fallback_${Date.now()}_${randomBytes(4).toString('hex')}`
  let probe: Client

  beforeAll(async () => {
    probe = new Client({ connectionString: PG_URL })
    await probe.connect()
    await probe.query(`CREATE SCHEMA "${schema}"`)
    const pool = new Pool({ connectionString: PG_URL, max: 2 })
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    await pool.end()
  }, 60_000)

  afterAll(async () => {
    if (!probe) return
    await probe.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await probe.end()
  }, 60_000)

  async function importGenes(file: string): Promise<Array<[number, string | null]>> {
    const messages: PostgresImportWorkerOutboundMessage[] = []
    await runImport(
      defaultDeps,
      {
        type: 'start',
        client: { connectionString: PG_URL },
        schema,
        mode: 'single-file',
        caseName: file,
        filePath: resolve(VCF_DIR, file),
        vcfOptions: { genomeBuild: 'GRCh38' },
        batchSize: 10_000
      },
      (message) => messages.push(message)
    )
    const last = messages.at(-1)
    if (last?.type !== 'complete') throw new Error(`import failed: ${JSON.stringify(last)}`)
    const rows = await probe.query<{ pos: string; gene_symbol: string | null }>(
      `SELECT pos, gene_symbol FROM "${schema}".variants WHERE case_id = $1 ORDER BY id`,
      [last.result.caseId]
    )
    return rows.rows.map((row) => [Number(row.pos), row.gene_symbol])
  }

  it('STR rows get the gene of their Stranger locus', async () => {
    expect(await importGenes('synthetic-str.vcf')).toEqual([
      [92071010, 'ATXN3'],
      [92071010, 'ATXN3'],
      [43776444, 'CSTB'],
      [149390803, 'NOTCH2NLC']
    ])
  }, 120_000)

  it('CNV rows keep annotated genes and get the overlapped gene otherwise', async () => {
    expect(await importGenes('synthetic-cnv.vcf')).toEqual([
      [5000000, 'GENE_A'],
      [10000000, 'GENE_B'],
      [29500000, 'THOC5']
    ])
  }, 120_000)
})
