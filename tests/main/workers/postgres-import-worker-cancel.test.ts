/**
 * The PostgreSQL import worker accepts an injected `isCancellationRequested`
 * (next to its message-driven flag). It must be honoured while a file is
 * being streamed, not only in the bookkeeping that follows.
 */
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/main/storage/postgres/postgres-bulk-write', () => ({
  runBulkCopy: vi.fn(async (params: { rows: AsyncIterable<Record<string, unknown>> }) => {
    for await (const row of params.rows) void row
  })
}))

vi.mock('../../../src/main/storage/postgres/PostgresCohortSummaryRepository', () => ({
  PostgresCohortSummaryRepository: class {
    incrementalAdd = vi.fn(async () => undefined)
    refreshColumnMetas = vi.fn(async () => undefined)
    markStale = vi.fn(async () => undefined)
  }
}))

import { runImportBehindHealthyFence as runImport } from './support/healthy-import-fence'
import { POSTGRES_IMPORT_CANCELLATION_MESSAGE } from '../../../src/shared/types/postgres-import-worker'

const TOTAL_ROWS = 5_000

function makeClient(queries: string[]): Record<string, unknown> {
  return {
    connect: vi.fn(async () => undefined),
    end: vi.fn(async () => undefined),
    query: vi.fn(async (sql: string | { text: string }, params?: unknown[]) => {
      const text = typeof sql === 'string' ? sql : sql.text
      queries.push(text)
      if (text.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] }
      if (text.startsWith('INSERT INTO') && text.includes('"cases')) return { rows: [{ id: 13 }] }
      if (text.includes('pg_get_serial_sequence') && text.includes('generate_series')) {
        const n = (params?.[1] as number) ?? 0
        return {
          rows: Array.from({ length: n }, (_, i) => ({ ordinal: String(i), id: String(5000 + i) }))
        }
      }
      return { rows: [] }
    })
  }
}

describe('postgres-import-worker — injected cancellation while streaming', () => {
  it.each([
    ['vcf', 'createVcfMappedStream'],
    ['json', 'createMapperPipeline']
  ] as const)('stops reading a %s file once cancellation is requested', async (format) => {
    let produced = 0
    function* rows(): Generator<Record<string, unknown>> {
      for (let i = 0; i < TOTAL_ROWS; i++) {
        produced += 1
        yield { chr: '1', pos: 100 + i, ref: 'A', alt: 'T', gt_num: '0/1', variant_type: 'snv' }
      }
    }
    const queries: string[] = []
    const messages: Array<Record<string, unknown>> = []

    await runImport(
      {
        createClient: () => makeClient(queries) as never,
        detectFormat: async () =>
          ({ format: format === 'vcf' ? 'vcf' : 'simple', caseKey: '' }) as never,
        createVcfMappedStream: async () => Readable.from(rows()) as never,
        createMapperPipeline: async () => Readable.from(rows()) as never,
        statFile: () => ({ size: 0 }),
        // Requested as soon as the first row has been read from the file.
        isCancellationRequested: () => produced > 0
      },
      {
        type: 'start',
        client: { connectionString: 'postgres://x' },
        schema: 'public',
        mode: 'single-file',
        caseName: 'cancelled case',
        filePath: format === 'vcf' ? '/tmp/a.vcf.gz' : '/tmp/a.json',
        format,
        batchSize: 50,
        ...(format === 'vcf'
          ? { vcfOptions: { selectedSample: 'NA12878', genomeBuild: 'GRCh38' } }
          : {})
      } as never,
      (message) => messages.push(message as Record<string, unknown>)
    )

    // The stream buffers a few rows ahead, but nowhere near the whole file.
    expect(produced).toBeLessThan(TOTAL_ROWS / 10)
    expect(queries.some((query) => query.includes("import_status = 'ready'"))).toBe(false)
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: 'complete',
        result: expect.objectContaining({ errors: [POSTGRES_IMPORT_CANCELLATION_MESSAGE] })
      })
    )
  })
})
