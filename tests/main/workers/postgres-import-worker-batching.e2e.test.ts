/**
 * Real-PostgreSQL check that byte-bounded batching does not change what the
 * import worker writes (issue #445): the same VCF imported as one batch and
 * as many small batches must produce identical variants, with every
 * transcript and SV child row attached to the same variant.
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires a reachable VARLENS_PG_URL.
 */
import { randomBytes } from 'node:crypto'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'

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
import type { PostgresImportWorkerOutboundMessage } from '../../../src/shared/types/postgres-import-worker'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

const VCF_DIR = resolve(__dirname, '../../test-data/vcf')

describe.skipIf(!RUN)('postgres-import-worker byte-bounded batches — real instance', () => {
  const schema = `varlens_test_batch_bytes_${Date.now()}_${randomBytes(4).toString('hex')}`
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

  async function importVcf(
    caseName: string,
    file: string,
    selectedSample: string,
    maxBatchBytes?: number
  ): Promise<{ caseId: number; variantCount: number; batches: number }> {
    const messages: PostgresImportWorkerOutboundMessage[] = []
    const deps: RunImportDeps = {
      createClient: (config) => new Client(config),
      detectFormat,
      createMapperPipeline,
      statFile: (path) => ({ size: statSync(path).size }),
      createVcfMappedStream: async (filePath, options) =>
        streamMappedVcfRows(filePath, options.selectedSample, options.filters, options.onSkip),
      maxBatchBytes
    }
    await runImport(
      deps,
      {
        type: 'start',
        client: { connectionString: PG_URL },
        schema,
        mode: 'single-file',
        caseName,
        filePath: resolve(VCF_DIR, file),
        vcfOptions: { selectedSample, genomeBuild: 'GRCh38' },
        batchSize: 10_000
      },
      (m) => messages.push(m)
    )
    const last = messages.at(-1)
    if (last?.type !== 'complete') throw new Error(`import failed: ${JSON.stringify(last)}`)
    return {
      caseId: last.result.caseId,
      variantCount: last.result.variantCount,
      batches: messages.filter((m) => m.type === 'progress' && m.phase === 'inserting').length
    }
  }

  /** Every variant of a case with its child rows, independent of row ids. */
  async function snapshot(caseId: number): Promise<unknown[]> {
    const result = await probe.query(
      `SELECT v.chr, v.pos, v.ref, v.alt, v.gene_symbol, v.transcript, v.variant_type,
              (SELECT COALESCE(array_agg(t.transcript_id ORDER BY t.transcript_id), '{}')
                 FROM "${schema}".variant_transcripts t WHERE t.variant_id = v.id) AS transcripts,
              (SELECT COUNT(*)::int FROM "${schema}".variant_sv s WHERE s.variant_id = v.id) AS sv_rows
         FROM "${schema}"."variants" v
        WHERE v.case_id = $1
        ORDER BY v.chr, v.pos, v.ref, v.alt, v.transcript`,
      [caseId]
    )
    return result.rows
  }

  it('writes identical variants and transcripts for one batch and for many byte-bounded batches', async () => {
    const whole = await importVcf('vep-one-batch', 'trio-region.vep.vcf.gz', 'HG005')
    // Lines are 750-2,629 bytes; a 16 KB budget forces a flush every few lines.
    const split = await importVcf('vep-byte-batches', 'trio-region.vep.vcf.gz', 'HG005', 16_384)

    expect(whole.batches).toBe(1)
    expect(split.batches).toBeGreaterThan(50)
    expect(split.variantCount).toBe(whole.variantCount)
    expect(whole.variantCount).toBeGreaterThan(100)

    const wholeRows = await snapshot(whole.caseId)
    expect(wholeRows.some((r) => (r as { transcripts: string[] }).transcripts.length > 0)).toBe(
      true
    )
    expect(await snapshot(split.caseId)).toEqual(wholeRows)
  }, 120_000)

  it('keeps SV child rows on their variants when every row is its own batch', async () => {
    const whole = await importVcf('sv-one-batch', 'synthetic-sv.vcf', 'SAMPLE1')
    const split = await importVcf('sv-byte-batches', 'synthetic-sv.vcf', 'SAMPLE1', 1)

    expect(split.batches).toBe(split.variantCount)
    const wholeRows = await snapshot(whole.caseId)
    expect(wholeRows.some((r) => (r as { sv_rows: number }).sv_rows === 1)).toBe(true)
    expect(await snapshot(split.caseId)).toEqual(wholeRows)
  }, 120_000)
})
