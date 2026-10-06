/**
 * Issue #445, PostgreSQL import worker: batches are bounded by source bytes
 * as well as rows, and the requested batch size is validated. No database is
 * needed — the pg client and the COPY writer are stand-ins.
 */
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

const copiedBatches: number[] = []
vi.mock('../../../src/main/storage/postgres/postgres-bulk-write', () => ({
  runBulkCopy: vi.fn(
    async (params: { sql: string; rows: AsyncIterable<unknown> | Iterable<unknown> }) => {
      let count = 0
      for await (const row of params.rows as AsyncIterable<unknown>) {
        void row
        count += 1
      }
      if (params.sql.includes('"variants_all"')) copiedBatches.push(count)
    }
  )
}))
vi.mock('../../../src/main/storage/postgres/PostgresCohortSummaryRepository', () => ({
  PostgresCohortSummaryRepository: class {
    incrementalAdd = async () => undefined
    recomputeCohortFrequency = async () => undefined
    refreshColumnMetas = async () => undefined
    markStale = async () => undefined
  }
}))

import { setRecordBytes } from '../../../src/main/import/bounded-batcher'
import { runImport, type RunImportDeps } from '../../../src/main/workers/postgres-import-worker'
import { ErrorCode } from '../../../src/shared/types/errors'
import type {
  PostgresImportWorkerOutboundMessage,
  PostgresImportWorkerStartMessage
} from '../../../src/shared/types/postgres-import-worker'

function fakeClient() {
  const client = {
    connect: vi.fn(async () => undefined),
    query: vi.fn(async (sql: string | { text: string }, params?: unknown[]) => {
      const text = typeof sql === 'string' ? sql : sql.text
      if (text.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] }
      if (text.startsWith('INSERT') && text.includes('"cases')) return { rows: [{ id: 11 }] }
      if (text.includes('pg_get_serial_sequence') && text.includes('generate_series')) {
        const n = (params?.[1] as number) ?? 0
        return {
          rows: Array.from({ length: n }, (_, i) => ({ ordinal: String(i), id: String(100 + i) }))
        }
      }
      if (text.includes('pg_get_serial_sequence')) return { rows: [{ id: 11 }] }
      return { rows: [] }
    }),
    end: vi.fn(async () => undefined)
  }
  return client
}

/** Mapped rows of `bytes` source bytes each, tagged the way the real streams tag them. */
function sizedRows(count: number, bytes: number): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, i) => {
    const row = { chr: '1', pos: i + 1, ref: 'A', alt: 'T', variant_type: 'snv' }
    setRecordBytes(row, bytes)
    return row
  })
}

const jsonStart: PostgresImportWorkerStartMessage = {
  type: 'start',
  client: { connectionString: 'postgres://x' },
  schema: 'public',
  mode: 'single-file',
  caseName: 'JSON case',
  filePath: '/tmp/a.json',
  format: 'json'
}

const vcfStart: PostgresImportWorkerStartMessage = {
  ...jsonStart,
  caseName: 'VCF case',
  filePath: '/tmp/a.vcf',
  format: 'vcf',
  vcfOptions: { selectedSample: 'S1', genomeBuild: 'GRCh38' }
}

async function run(
  start: PostgresImportWorkerStartMessage,
  deps: Partial<RunImportDeps>
): Promise<{ messages: PostgresImportWorkerOutboundMessage[]; connect: ReturnType<typeof vi.fn> }> {
  const client = fakeClient()
  const messages: PostgresImportWorkerOutboundMessage[] = []
  await runImport(
    {
      createClient: () => client as never,
      detectFormat: async () =>
        ({ format: start.format === 'vcf' ? 'vcf' : 'simple', caseKey: '' }) as never,
      createMapperPipeline: async () => Readable.from([]),
      createVcfMappedStream: async () => Readable.from([]) as never,
      statFile: () => ({ size: 0 }),
      ...deps
    },
    start,
    (m) => messages.push(m)
  )
  return { messages, connect: client.connect }
}

function insertProgress(messages: PostgresImportWorkerOutboundMessage[]): number[] {
  return messages.flatMap((m) =>
    m.type === 'progress' && m.phase === 'inserting' ? [m.rowsProcessed] : []
  )
}

describe('postgres-import-worker byte-bounded batches', () => {
  it('flushes oversized JSON records on the byte budget, not the row limit', async () => {
    // 10 KB records against a 25 KB budget: every third record crosses it.
    const { messages } = await run(
      { ...jsonStart, batchSize: 1000 },
      {
        createMapperPipeline: async () => Readable.from(sizedRows(10, 10_000)),
        maxBatchBytes: 25_000
      }
    )

    expect(insertProgress(messages)).toEqual([3, 6, 9, 10])
    expect(messages.at(-1)).toMatchObject({ type: 'complete', result: { variantCount: 10 } })
  })

  it('keeps one JSON batch when the byte budget is not reached', async () => {
    const { messages } = await run(
      { ...jsonStart, batchSize: 1000 },
      { createMapperPipeline: async () => Readable.from(sizedRows(10, 10_000)) }
    )

    expect(insertProgress(messages)).toEqual([10])
  })

  it('flushes oversized VCF rows on the byte budget, one COPY per batch', async () => {
    copiedBatches.length = 0
    const { messages } = await run(
      { ...vcfStart, batchSize: 1000 },
      {
        createVcfMappedStream: async () => Readable.from(sizedRows(10, 10_000)) as never,
        maxBatchBytes: 25_000
      }
    )

    expect(copiedBatches).toEqual([3, 3, 3, 1])
    expect(insertProgress(messages)).toEqual([3, 6, 9, 10])
    expect(messages.at(-1)).toMatchObject({ type: 'complete', result: { variantCount: 10 } })
  })

  it('flushes oversized rows on the byte budget in multi-file mode', async () => {
    copiedBatches.length = 0
    const { messages } = await run(
      {
        ...vcfStart,
        mode: 'multi-file',
        filePath: undefined,
        files: [{ filePath: '/tmp/a.vcf', variantType: 'snv-indel' } as never],
        batchSize: 1000
      },
      {
        createVcfMappedStream: async () => Readable.from(sizedRows(5, 10_000)) as never,
        maxBatchBytes: 25_000
      }
    )

    expect(copiedBatches).toEqual([3, 2])
    expect(messages.at(-1)).toMatchObject({ type: 'complete', result: { variantCount: 5 } })
  })
})

describe('postgres-import-worker batchSize validation', () => {
  it.each([0, -1, 1.5, 50_001, Number.NaN, '100' as unknown as number])(
    'rejects batchSize %p with a typed error before connecting',
    async (batchSize) => {
      const { messages, connect } = await run({ ...jsonStart, batchSize }, {})

      expect(messages).toHaveLength(1)
      expect(messages[0]).toMatchObject({ type: 'error', code: ErrorCode.INVALID_PARAMETERS })
      expect((messages[0] as { message: string }).message).toMatch(/batchSize must be an integer/)
      expect(connect).not.toHaveBeenCalled()
    }
  )

  it.each([1, 50_000])('accepts batchSize %p', async (batchSize) => {
    const { messages } = await run(
      { ...jsonStart, batchSize },
      { createMapperPipeline: async () => Readable.from(sizedRows(2, 10)) }
    )

    expect(messages.at(-1)).toMatchObject({ type: 'complete', result: { variantCount: 2 } })
  })
})
