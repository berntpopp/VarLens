import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Phase 16+: VCF imports write via runBulkCopy (pg-copy-streams). The mock
// here drains the rows iterator so the worker's per-batch contract still
// runs, but doesn't go through a real pg connection. Repository contract
// (id reservation + extension-row variant_id resolution) is exercised in
// tests/main/storage/postgres-vcf-import-repository.test.ts.
vi.mock('../../../src/main/storage/postgres/postgres-bulk-write', () => ({
  runBulkCopy: vi.fn(
    async (params: {
      rows: AsyncIterable<Record<string, unknown>> | Iterable<Record<string, unknown>>
    }) => {
      for await (const row of params.rows as AsyncIterable<Record<string, unknown>>) {
        void row
      }
    }
  )
}))

// C3: spy on the cohort summary repo so the import-wiring tests can assert the
// post-loop SAVEPOINT block calls incrementalAdd / recomputeCohortFrequency /
// refreshColumnMetas without standing up a real Postgres. Each test overrides
// the mock implementations via the exported spies below.
const incrementalAddSpy = vi.fn(async () => undefined)
const recomputeCohortFrequencySpy = vi.fn(async () => undefined)
const refreshColumnMetasSpy = vi.fn(async () => undefined)
const markStaleSpy = vi.fn(async () => undefined)
vi.mock('../../../src/main/storage/postgres/PostgresCohortSummaryRepository', () => ({
  PostgresCohortSummaryRepository: class {
    incrementalAdd = incrementalAddSpy
    recomputeCohortFrequency = recomputeCohortFrequencySpy
    refreshColumnMetas = refreshColumnMetasSpy
    markStale = markStaleSpy
  }
}))

import { runImport } from '../../../src/main/workers/postgres-import-worker'
import {
  POSTGRES_IMPORT_CANCELLATION_MESSAGE,
  type PostgresImportWorkerStartMessage
} from '../../../src/shared/types/postgres-import-worker'

const acquiredImportLock = { rows: [{ locked: true }] }

describe('postgres-import-worker runImport', () => {
  it('refuses a second workspace import while another session owns the advisory lock', async () => {
    const messages: unknown[] = []
    const detectFormat = vi.fn()
    const client = {
      connect: vi.fn(async () => undefined),
      query: vi.fn(async (sql: string | { text: string }) => {
        const text = typeof sql === 'string' ? sql : sql.text
        if (text.includes('pg_try_advisory_lock')) return { rows: [{ locked: false }] }
        return { rows: [] }
      }),
      end: vi.fn(async () => undefined)
    }

    await runImport(
      {
        createClient: () => client as never,
        detectFormat,
        createVcfMappedStream: async () => Readable.from([]) as never,
        createMapperPipeline: async () => Readable.from([]),
        statFile: () => ({ size: 0 })
      },
      {
        type: 'start',
        client: { connectionString: 'postgres://x' },
        schema: 'public',
        mode: 'single-file',
        caseName: 'locked',
        filePath: '/tmp/a.vcf'
      },
      (message) => messages.push(message)
    )

    expect(detectFormat).not.toHaveBeenCalled()
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: 'error',
        message: expect.stringMatching(/already in progress/)
      })
    )
  })

  it('fails closed when PostgreSQL does not confirm advisory-lock ownership', async () => {
    const messages: unknown[] = []
    const detectFormat = vi.fn()
    const client = {
      connect: vi.fn(async () => undefined),
      query: vi.fn(async () => ({ rows: [] })),
      end: vi.fn(async () => undefined)
    }

    await runImport(
      {
        createClient: () => client as never,
        detectFormat,
        createVcfMappedStream: async () => Readable.from([]) as never,
        createMapperPipeline: async () => Readable.from([]),
        statFile: () => ({ size: 0 })
      },
      {
        type: 'start',
        client: { connectionString: 'postgres://x' },
        schema: 'public',
        mode: 'single-file',
        caseName: 'unconfirmed-lock',
        filePath: '/tmp/a.vcf'
      },
      (message) => messages.push(message)
    )

    expect(detectFormat).not.toHaveBeenCalled()
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: 'error',
        message: expect.stringMatching(/already in progress/)
      })
    )
  })

  it('drives VCF parsing and writes through PostgresVcfImportRepository', async () => {
    const queries: string[] = []
    const client = {
      connect: vi.fn(async () => undefined),
      query: vi.fn(async (sql: string | { text: string }, params?: unknown[]) => {
        const text = typeof sql === 'string' ? sql : sql.text
        queries.push(text)
        if (text.includes('pg_try_advisory_lock')) return acquiredImportLock
        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] }
        if (text.startsWith('SELECT id FROM') && text.includes('"cases')) return { rows: [] }
        if (text.startsWith('INSERT INTO') && text.includes('"cases')) return { rows: [{ id: 13 }] }
        // Phase 16+: ID reservation via pg_get_serial_sequence + generate_series.
        if (text.includes('pg_get_serial_sequence') && text.includes('generate_series')) {
          const n = (params?.[1] as number) ?? 0
          return {
            rows: Array.from({ length: n }, (_, i) => ({
              ordinal: String(i),
              id: String(5000 + i)
            }))
          }
        }
        if (text.includes('pg_get_serial_sequence')) return { rows: [{ id: 13 }] }
        return { rows: [] }
      }),
      end: vi.fn(async () => undefined)
    }
    const messages: unknown[] = []

    // Build a minimal mapped row matching the VcfMappedVariant shape.
    const fakeVariant = {
      chr: '1',
      pos: 100,
      ref: 'A',
      alt: 'T',
      gene_symbol: 'BRCA1',
      omim_mim_number: null,
      consequence: 'HIGH',
      gnomad_af: null,
      cadd: null,
      clinvar: null,
      gt_num: '0/1',
      func: 'missense_variant',
      qual: 50,
      hpo_sim_score: null,
      transcript: 'ENST1',
      cdna: 'c.1A>T',
      aa_change: 'p.M1I',
      hpo_match: null,
      moi: null,
      gq: 99,
      dp: 30,
      ad_ref: 15,
      ad_alt: 15,
      ab: 0.5,
      filter: 'PASS',
      info_json: null,
      source_format: 'vcf',
      variant_type: 'snv',
      end_pos: null,
      sv_type: null,
      sv_length: null,
      caller: null
    }

    await runImport(
      {
        createClient: () => client as never,
        detectFormat: async () => ({ format: 'vcf', caseKey: '' }) as never,
        createVcfMappedStream: async () => Readable.from([fakeVariant, fakeVariant]) as never,
        createMapperPipeline: async () => Readable.from([]),
        statFile: () => ({ size: 0 })
      },
      {
        type: 'start',
        client: { connectionString: 'postgres://x' },
        schema: 'public',
        mode: 'single-file',
        caseName: 'VCF case',
        filePath: '/tmp/a.vcf.gz',
        format: 'vcf',
        vcfOptions: { selectedSample: 'NA12878', genomeBuild: 'GRCh38' },
        batchSize: 1
      },
      (m) => messages.push(m)
    )

    // Phase 16.1: relaxImportSessionLimits issues SET statement_timeout = 0
    // (and friends) before any BEGIN. The transaction lifecycle is still
    // present, just no longer the very first query.
    expect(queries).toContain('BEGIN')
    expect(queries).toContain('COMMIT')
    // VCF imports now write via COPY FROM STDIN (mocked at the runBulkCopy
    // boundary in this test's deps), but the post-loop bookkeeping
    // (variant_frequency rebuild + variant_count update) is unchanged.
    expect(queries.find((q) => q.includes('"variant_frequency"'))).toBeDefined()
    expect(queries.find((q) => q.startsWith('UPDATE') && q.includes('variant_count'))).toBeDefined()
    const reserveIndexes = queries.flatMap((query, index) =>
      query.includes('generate_series') ? [index] : []
    )
    const caseInsertIndex = queries.findIndex(
      (query) => query.startsWith('INSERT INTO') && query.includes('"cases')
    )
    expect(reserveIndexes).toHaveLength(2)
    expect(queries.slice(reserveIndexes[0], reserveIndexes[1])).toContain('COMMIT')
    expect(caseInsertIndex).toBeLessThan(reserveIndexes[0])

    const complete = messages.find(
      (m): m is { type: 'complete'; result: { variantCount: number } } =>
        (m as { type: string }).type === 'complete'
    )
    expect(complete).toBeDefined()
    expect(complete?.result.variantCount).toBe(2)
  })

  it('rolls back a single-file VCF when the stream fails after a flushed batch', async () => {
    const queries: string[] = []
    const client = {
      connect: vi.fn(async () => undefined),
      query: vi.fn(async (sql: string | { text: string }, params?: unknown[]) => {
        const text = typeof sql === 'string' ? sql : sql.text
        queries.push(text)
        if (text.includes('pg_try_advisory_lock')) return acquiredImportLock
        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] }
        if (text.startsWith('SELECT id FROM') && text.includes('"cases')) return { rows: [] }
        if (text.startsWith('INSERT INTO') && text.includes('"cases')) return { rows: [{ id: 13 }] }
        if (text.includes('pg_get_serial_sequence') && text.includes('generate_series')) {
          const n = (params?.[1] as number) ?? 0
          return {
            rows: Array.from({ length: n }, (_, i) => ({
              ordinal: String(i),
              id: String(5000 + i)
            }))
          }
        }
        if (text.includes('pg_get_serial_sequence')) return { rows: [{ id: 13 }] }
        return { rows: [] }
      }),
      end: vi.fn(async () => undefined)
    }
    const messages: unknown[] = []
    const fakeVariant = {
      chr: '1',
      pos: 100,
      ref: 'A',
      alt: 'T',
      gene_symbol: null,
      omim_mim_number: null,
      consequence: null,
      gnomad_af: null,
      cadd: null,
      clinvar: null,
      gt_num: null,
      func: null,
      qual: null,
      hpo_sim_score: null,
      transcript: null,
      cdna: null,
      aa_change: null,
      hpo_match: null,
      moi: null,
      gq: null,
      dp: null,
      ad_ref: null,
      ad_alt: null,
      ab: null,
      filter: null,
      info_json: null,
      source_format: 'vcf',
      variant_type: 'snv',
      end_pos: null,
      sv_type: null,
      sv_length: null,
      caller: null
    }

    async function* rows(): AsyncGenerator<typeof fakeVariant, void, void> {
      yield fakeVariant
      throw new Error('stream failed after flushed batch')
    }

    await runImport(
      {
        createClient: () => client as never,
        detectFormat: async () => ({ format: 'vcf', caseKey: '' }) as never,
        createVcfMappedStream: async () => rows() as never,
        createMapperPipeline: async () => Readable.from([]),
        statFile: () => ({ size: 0 })
      },
      {
        type: 'start',
        client: { connectionString: 'postgres://x' },
        schema: 'public',
        mode: 'single-file',
        caseName: 'VCF case',
        filePath: '/tmp/a.vcf.gz',
        format: 'vcf',
        vcfOptions: { selectedSample: 'NA12878', genomeBuild: 'GRCh38' },
        batchSize: 1
      },
      (m) => messages.push(m)
    )

    expect(queries).toContain('COMMIT')
    expect(queries.some((query) => query.includes('DELETE FROM "public"."variants_all"'))).toBe(
      true
    )
    expect(queries.some((query) => query.includes('DELETE FROM "public"."cases_all"'))).toBe(true)
    const error = messages.find((m): m is { type: 'error'; message: string } => {
      return (m as { type: string }).type === 'error'
    })
    expect(error?.message).toMatch(/stream failed after flushed batch/)
  })

  it('runs one transaction per file in multi-file mode and surfaces per-file errors', async () => {
    const queries: string[] = []
    const client = {
      connect: vi.fn(async () => undefined),
      query: vi.fn(async (sql: string | { text: string }, params?: unknown[]) => {
        const text = typeof sql === 'string' ? sql : sql.text
        queries.push(text)
        if (text.includes('pg_try_advisory_lock')) return acquiredImportLock
        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] }
        // For the duplicate check (fileIndex 0) return empty; for the case-lookup
        // (fileIndex >= 1) return the case that file 1 created.
        if (text.startsWith('SELECT id FROM') && text.includes('"cases')) {
          // File 1 duplicate check fires before INSERT — return empty.
          // File 2 case lookup fires after file 1 committed — return the case.
          const alreadyInserted = queries.filter(
            (q) => q.startsWith('INSERT INTO') && q.includes('"cases')
          ).length
          return alreadyInserted > 0 ? { rows: [{ id: 21 }] } : { rows: [] }
        }
        if (text.startsWith('INSERT INTO') && text.includes('"cases')) {
          return { rows: [{ id: 21 }] }
        }
        if (text.includes('pg_get_serial_sequence') && text.includes('generate_series')) {
          const n = (params?.[1] as number) ?? 0
          return {
            rows: Array.from({ length: n }, (_, i) => ({
              ordinal: String(i),
              id: String(5000 + i)
            }))
          }
        }
        return { rows: [] }
      }),
      end: vi.fn(async () => undefined)
    }
    const { Readable } = await import('node:stream')
    const fakeRow = {
      chr: '1',
      pos: 100,
      ref: 'A',
      alt: 'T',
      gene_symbol: null,
      omim_mim_number: null,
      consequence: null,
      gnomad_af: null,
      cadd: null,
      clinvar: null,
      gt_num: null,
      func: null,
      qual: null,
      hpo_sim_score: null,
      transcript: null,
      cdna: null,
      aa_change: null,
      hpo_match: null,
      moi: null,
      gq: null,
      dp: null,
      ad_ref: null,
      ad_alt: null,
      ab: null,
      filter: null,
      info_json: null,
      source_format: 'vcf',
      variant_type: 'snv',
      end_pos: null,
      sv_type: null,
      sv_length: null,
      caller: null
    }
    const messages: unknown[] = []
    async function* failingSecondFile(): AsyncGenerator<typeof fakeRow, void, void> {
      yield fakeRow
      throw new Error('late failure in file 2')
    }
    await runImport(
      {
        createClient: () => client as never,
        detectFormat: async () => ({ format: 'vcf', caseKey: '' }) as never,
        createVcfMappedStream: async (filePath) =>
          filePath.endsWith('/b.vcf.gz')
            ? (failingSecondFile() as never)
            : (Readable.from([fakeRow]) as never),
        createMapperPipeline: async () => Readable.from([]),
        statFile: () => ({ size: 0 })
      },
      {
        type: 'start',
        client: { connectionString: 'postgres://x' },
        schema: 'public',
        mode: 'multi-file',
        caseName: 'Multi',
        vcfOptions: { selectedSample: 'NA12878', genomeBuild: 'GRCh38' },
        files: [
          {
            filePath: '/tmp/a.vcf.gz',
            variantType: 'snv-indel',
            annotationFormat: null,
            caller: null
          },
          {
            filePath: '/tmp/b.vcf.gz',
            variantType: 'snv-indel',
            annotationFormat: null,
            caller: null
          }
        ],
        batchSize: 1
      },
      (m) => messages.push(m)
    )

    // Each production batch commits independently; failed current-file rows
    // are deleted in bounded cleanup transactions before bookkeeping.
    const beginCount = queries.filter((q) => q === 'BEGIN').length
    // Two production batches, bounded failed-file cleanup, and one atomic
    // bookkeeping/publication transaction.
    expect(beginCount).toBe(5)
    expect(queries.some((query) => query.includes('DELETE FROM "public"."variants_all"'))).toBe(
      true
    )
    expect(queries.includes('COMMIT')).toBe(true)

    const complete = messages.find(
      (m): m is { type: 'complete'; result: { files: Array<{ error?: string }> } } =>
        (m as { type: string }).type === 'complete'
    )
    expect(complete).toBeDefined()
    const result = complete!.result
    expect(result.files[0].error).toBeUndefined()
    expect(result.files[1].error).toMatch(/late failure in file 2/)

    const provenanceCall = client.query.mock.calls.find(([sql]) => {
      const text = typeof sql === 'string' ? sql : sql.text
      return text.includes('INSERT INTO') && text.includes('"case_data_info"')
    })
    expect(provenanceCall?.[1]?.[1]).toBe('a.vcf.gz')
  })

  it('opens client, runs BEGIN/COMMIT for single-file JSON, posts complete', async () => {
    const queries: string[] = []
    const client = {
      connect: vi.fn(async () => undefined),
      query: vi.fn(async (sql: string | { text: string }) => {
        const text = typeof sql === 'string' ? sql : sql.text
        queries.push(text)
        if (text.includes('pg_try_advisory_lock')) return acquiredImportLock
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] }
        if (typeof sql === 'string' && sql.startsWith('SELECT id FROM')) return { rows: [] }
        if (typeof sql === 'string' && sql.includes('"cases"') && sql.startsWith('INSERT')) {
          return { rows: [{ id: 11 }] }
        }
        return { rows: [] }
      }),
      end: vi.fn(async () => undefined)
    }
    const messages: unknown[] = []
    const post = (m: unknown) => messages.push(m)

    const start: PostgresImportWorkerStartMessage = {
      type: 'start',
      client: { connectionString: 'postgres://x' },
      schema: 'public',
      mode: 'single-file',
      caseName: 'JSON case',
      filePath: '/tmp/a.json',
      format: 'json'
    }

    await runImport(
      {
        createClient: () => client as never,
        detectFormat: async () => ({ format: 'simple', caseKey: '' }) as never,
        createMapperPipeline: async () => {
          const { Readable } = await import('node:stream')
          return Readable.from([{ chr: '1', pos: 1, ref: 'A', alt: 'T' }])
        },
        statFile: () => ({ size: 100 })
      },
      start,
      post
    )

    // Phase 16.1: relaxImportSessionLimits issues SET statement_timeout = 0
    // before any BEGIN.
    expect(queries).toContain('BEGIN')
    expect(queries.some((q) => q.startsWith('SELECT id FROM'))).toBe(true)
    expect(queries.some((q) => q.includes('"cases"') && q.startsWith('INSERT'))).toBe(true)
    expect(queries.some((q) => q.includes('"variant_frequency"'))).toBe(true)
    expect(queries).toContain('COMMIT')
    expect(queries.at(-1)).toContain('pg_advisory_unlock')

    const complete = messages.find(
      (m): m is { type: 'complete' } => (m as { type: string }).type === 'complete'
    )
    expect(complete).toBeDefined()
  })

  it('rolls back a single-file JSON import when the stream fails after a flushed batch', async () => {
    const queries: string[] = []
    const client = {
      connect: vi.fn(async () => undefined),
      query: vi.fn(async (sql: string | { text: string }) => {
        const text = typeof sql === 'string' ? sql : sql.text
        queries.push(text)
        if (text.includes('pg_try_advisory_lock')) return acquiredImportLock
        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] }
        if (text.startsWith('SELECT id FROM')) return { rows: [] }
        if (text.startsWith('INSERT INTO') && text.includes('"cases"')) {
          return { rows: [{ id: 11 }] }
        }
        return { rows: [] }
      }),
      end: vi.fn(async () => undefined)
    }
    const messages: unknown[] = []
    async function* rows(): AsyncGenerator<Record<string, unknown>, void, void> {
      yield { chr: '1', pos: 1, ref: 'A', alt: 'T' }
      throw new Error('late JSON stream failure')
    }

    await runImport(
      {
        createClient: () => client as never,
        detectFormat: async () => ({ format: 'simple', caseKey: '' }) as never,
        createMapperPipeline: async () => Readable.from(rows()),
        createVcfMappedStream: async () => Readable.from([]) as never,
        statFile: () => ({ size: 100 })
      },
      {
        type: 'start',
        client: { connectionString: 'postgres://x' },
        schema: 'public',
        mode: 'single-file',
        caseName: 'JSON case',
        filePath: '/tmp/a.json',
        format: 'json',
        batchSize: 1
      },
      (message) => messages.push(message)
    )

    expect(queries).toContain('ROLLBACK')
    expect(queries).not.toContain('COMMIT')
    expect(messages).toContainEqual({ type: 'error', message: 'late JSON stream failure' })
  })

  it('loads BedFilter and applies pre/post-mapping filters in multi-file mode', async () => {
    const queries: string[] = []
    const client = {
      connect: vi.fn(async () => undefined),
      query: vi.fn(async (sql: string | { text: string }, params?: unknown[]) => {
        const text = typeof sql === 'string' ? sql : sql.text
        queries.push(text)
        if (text.includes('pg_try_advisory_lock')) return acquiredImportLock
        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] }
        if (text.startsWith('SELECT id FROM') && text.includes('"cases')) return { rows: [] }
        if (text.startsWith('INSERT INTO') && text.includes('"cases')) return { rows: [{ id: 11 }] }
        if (text.includes('"variants"') && text.includes('jsonb_to_recordset')) {
          const payload = JSON.parse(String((params as unknown[])[0])) as unknown[]
          return { rows: payload.map((_, i) => ({ id: 6000 + i })) }
        }
        return { rows: [] }
      }),
      end: vi.fn(async () => undefined)
    }
    const { Readable } = await import('node:stream')

    let createVcfMappedStreamCalledWithFilters: unknown = undefined
    await runImport(
      {
        createClient: () => client as never,
        detectFormat: async () => ({ format: 'vcf', caseKey: '' }) as never,
        createVcfMappedStream: async (_filePath, options) => {
          createVcfMappedStreamCalledWithFilters = options.filters
          return Readable.from([]) as never
        },
        createMapperPipeline: async () => Readable.from([]),
        statFile: () => ({ size: 0 })
      },
      {
        type: 'start',
        client: { connectionString: 'postgres://x' },
        schema: 'public',
        mode: 'multi-file',
        caseName: 'F',
        vcfOptions: { selectedSample: 'NA12878', genomeBuild: 'GRCh38' },
        files: [
          {
            filePath: '/tmp/a.vcf.gz',
            variantType: 'snv-indel',
            annotationFormat: null,
            caller: null
          }
        ],
        filters: {
          passOnly: true,
          minQual: 30,
          minGq: 20,
          minDp: 10
          // Omit bedFilePath — we don't want to read a real BED file in the test.
        }
      },
      () => {}
    )

    // Verify the worker constructed an ImportFilters and passed it to the stream factory.
    expect(createVcfMappedStreamCalledWithFilters).toBeDefined()
    const filters = createVcfMappedStreamCalledWithFilters as Record<string, unknown>
    expect(filters.passOnly).toBe(true)
    expect(filters.minQual).toBe(30)
    expect(filters.minGq).toBe(20)
    expect(filters.minDp).toBe(10)
    // bedFilter is undefined because we didn't supply a bedFilePath.
    expect(filters.bedFilter).toBeUndefined()
  })

  it('fails closed when an explicitly requested BED filter cannot be loaded', async () => {
    const client = {
      connect: vi.fn(async () => undefined),
      query: vi.fn(async (sql: string | { text: string }) => {
        const text = typeof sql === 'string' ? sql : sql.text
        return text.includes('pg_try_advisory_lock') ? acquiredImportLock : { rows: [] }
      }),
      end: vi.fn(async () => undefined)
    }
    const createVcfMappedStream = vi.fn(async () => Readable.from([]) as never)
    const messages: Array<{ type: string; message?: string }> = []

    await runImport(
      {
        createClient: () => client as never,
        detectFormat: async () => ({ format: 'vcf', caseKey: '' }) as never,
        createVcfMappedStream,
        createMapperPipeline: async () => Readable.from([]),
        statFile: () => ({ size: 0 })
      },
      {
        type: 'start',
        client: { connectionString: 'postgres://x' },
        schema: 'public',
        mode: 'multi-file',
        caseName: 'F',
        files: [
          {
            filePath: '/tmp/a.vcf.gz',
            variantType: 'snv-indel',
            annotationFormat: null,
            caller: null
          }
        ],
        filters: { bedFilePath: '/tmp/varlens-missing-pg-filter.bed' }
      },
      (message) => messages.push(message)
    )

    expect(createVcfMappedStream).not.toHaveBeenCalled()
    expect(messages).toContainEqual(
      expect.objectContaining({ type: 'error', message: expect.stringMatching(/ENOENT/i) })
    )
  })

  it('applies multi-file filters only to append files when a base file creates the case', async () => {
    const client = {
      connect: vi.fn(async () => undefined),
      query: vi.fn(async (sql: string | { text: string }) => {
        const text = typeof sql === 'string' ? sql : sql.text
        if (text.includes('pg_try_advisory_lock')) return acquiredImportLock
        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] }
        if (text.startsWith('INSERT INTO') && text.includes('"cases_all"')) {
          return { rows: [{ id: 11 }] }
        }
        return { rows: [] }
      }),
      end: vi.fn(async () => undefined)
    }
    const { Readable } = await import('node:stream')
    const filtersByFile = new Map<string, unknown>()

    await runImport(
      {
        createClient: () => client as never,
        detectFormat: async () => ({ format: 'vcf', caseKey: '' }) as never,
        createVcfMappedStream: async (filePath, options) => {
          filtersByFile.set(filePath, options.filters)
          return Readable.from([]) as never
        },
        createMapperPipeline: async () => Readable.from([]),
        statFile: () => ({ size: 0 })
      },
      {
        type: 'start',
        client: { connectionString: 'postgres://x' },
        schema: 'public',
        mode: 'multi-file',
        caseName: 'F',
        vcfOptions: { selectedSample: 'NA12878', genomeBuild: 'GRCh38' },
        files: [
          {
            filePath: '/tmp/base.vcf.gz',
            variantType: 'snv-indel',
            annotationFormat: null,
            caller: null
          },
          {
            filePath: '/tmp/append.vcf.gz',
            variantType: 'snv-indel',
            annotationFormat: null,
            caller: null
          }
        ],
        filters: {
          passOnly: true,
          minQual: 30
        }
      },
      () => {}
    )

    expect(filtersByFile.get('/tmp/base.vcf.gz')).toBeUndefined()
    expect(filtersByFile.get('/tmp/append.vcf.gz')).toMatchObject({
      passOnly: true,
      minQual: 30
    })
  })
})

describe('postgres-import-worker — C3 import wiring', () => {
  beforeEach(() => {
    incrementalAddSpy.mockReset().mockResolvedValue(undefined)
    recomputeCohortFrequencySpy.mockReset().mockResolvedValue(undefined)
    refreshColumnMetasSpy.mockReset().mockResolvedValue(undefined)
    markStaleSpy.mockReset().mockResolvedValue(undefined)
  })

  const fakeVariant = {
    chr: '1',
    pos: 100,
    ref: 'A',
    alt: 'T',
    gene_symbol: 'BRCA1',
    omim_mim_number: null,
    consequence: 'HIGH',
    gnomad_af: null,
    cadd: null,
    clinvar: null,
    gt_num: '0/1',
    func: 'missense_variant',
    qual: 50,
    hpo_sim_score: null,
    transcript: 'ENST1',
    cdna: 'c.1A>T',
    aa_change: 'p.M1I',
    hpo_match: null,
    moi: null,
    gq: 99,
    dp: 30,
    ad_ref: 15,
    ad_alt: 15,
    ab: 0.5,
    filter: 'PASS',
    info_json: null,
    source_format: 'vcf',
    variant_type: 'snv',
    end_pos: null,
    sv_type: null,
    sv_length: null,
    caller: null
  }

  const makeClient = (
    queries: string[]
  ): {
    connect: ReturnType<typeof vi.fn>
    query: ReturnType<typeof vi.fn>
    end: ReturnType<typeof vi.fn>
  } => ({
    connect: vi.fn(async () => undefined),
    query: vi.fn(async (sql: string | { text: string }, params?: unknown[]) => {
      const text = typeof sql === 'string' ? sql : sql.text
      queries.push(text)
      if (text.includes('pg_try_advisory_lock')) return acquiredImportLock
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] }
      if (text.startsWith('SELECT id FROM') && text.includes('"cases')) return { rows: [] }
      if (text.startsWith('INSERT INTO') && text.includes('"cases')) return { rows: [{ id: 13 }] }
      if (text.includes('pg_get_serial_sequence') && text.includes('generate_series')) {
        const n = (params?.[1] as number) ?? 0
        return {
          rows: Array.from({ length: n }, (_, i) => ({ ordinal: String(i), id: String(5000 + i) }))
        }
      }
      return { rows: [] }
    }),
    end: vi.fn(async () => undefined)
  })

  const runVcfSingleFile = async (
    client: ReturnType<typeof makeClient>,
    messages: unknown[],
    overrides: { isCancellationRequested?: () => boolean } = {}
  ): Promise<void> => {
    await runImport(
      {
        createClient: () => client as never,
        detectFormat: async () => ({ format: 'vcf', caseKey: '' }) as never,
        createVcfMappedStream: async () => Readable.from([fakeVariant]) as never,
        createMapperPipeline: async () => Readable.from([]),
        statFile: () => ({ size: 0 }),
        ...overrides
      },
      {
        type: 'start',
        client: { connectionString: 'postgres://x' },
        schema: 'public',
        mode: 'single-file',
        caseName: 'VCF case',
        filePath: '/tmp/a.vcf.gz',
        format: 'vcf',
        vcfOptions: { selectedSample: 'NA12878', genomeBuild: 'GRCh38' }
      },
      (m) => messages.push(m)
    )
  }

  it('updates cohort_variant_summary after a successful import', async () => {
    const queries: string[] = []
    const client = makeClient(queries)
    const messages: unknown[] = []
    await runVcfSingleFile(client, messages)

    // The summary update is wrapped in a SAVEPOINT inside the post-loop txn.
    expect(queries).toContain('SAVEPOINT cohort_summary')
    expect(queries).toContain('RELEASE SAVEPOINT cohort_summary')
    expect(queries).not.toContain('ROLLBACK TO SAVEPOINT cohort_summary')

    expect(incrementalAddSpy).toHaveBeenCalledTimes(1)
    expect(incrementalAddSpy).toHaveBeenCalledWith(
      expect.objectContaining({ schema: 'public', caseId: 13, genomeBuild: 'GRCh38' })
    )
    expect(recomputeCohortFrequencySpy).toHaveBeenCalledWith(
      expect.objectContaining({ schema: 'public', affectedBuilds: ['GRCh38'] })
    )
    expect(refreshColumnMetasSpy).toHaveBeenCalledWith(
      expect.objectContaining({ schema: 'public', caseId: 13 })
    )

    // SAVEPOINT must come AFTER the variant_count bookkeeping and BEFORE the
    // final COMMIT (Pass-3 HIGH #1 + Pass-4 HIGH #2).
    const savepointIdx = queries.indexOf('SAVEPOINT cohort_summary')
    const bookkeepingIdx = queries.findIndex(
      (q) => q.startsWith('UPDATE') && q.includes('variant_count')
    )
    expect(bookkeepingIdx).toBeGreaterThanOrEqual(0)
    expect(savepointIdx).toBeGreaterThan(bookkeepingIdx)
    expect(queries.lastIndexOf('COMMIT')).toBeGreaterThan(savepointIdx)

    expect(markStaleSpy).not.toHaveBeenCalled()
  })

  it('keeps the provisional case hidden and publishes derived bookkeeping atomically', async () => {
    const queries: string[] = []
    const client = makeClient(queries)
    const messages: unknown[] = []
    await runVcfSingleFile(client, messages)

    const countIndex = queries.findIndex(
      (query) => query.startsWith('UPDATE') && query.includes('variant_count')
    )
    const frequencyIndex = queries.findIndex((query) => query.includes('"variant_frequency"'))
    const readyIndex = queries.findIndex(
      (query) => query.startsWith('UPDATE') && query.includes("import_status = 'ready'")
    )

    expect(queries[countIndex]).toContain('"cases_all"')
    expect(queries[frequencyIndex]).toContain('"variants_all"')
    expect(readyIndex).toBeGreaterThan(frequencyIndex)

    const publicationBeginIndex = queries.findLastIndex(
      (query, index) => index < countIndex && query === 'BEGIN'
    )
    const publicationCommitIndex = queries.findIndex(
      (query, index) => index > readyIndex && query === 'COMMIT'
    )

    expect(publicationBeginIndex).toBeGreaterThanOrEqual(0)
    expect(queries.slice(frequencyIndex, readyIndex)).not.toContain('COMMIT')
    expect(publicationCommitIndex).toBeGreaterThan(readyIndex)

    const publicationQueries = queries.slice(publicationBeginIndex, publicationCommitIndex + 1)
    expect(publicationQueries.some((query) => query.includes('"variant_frequency"'))).toBe(true)
    expect(publicationQueries).toContain('SAVEPOINT cohort_summary')
  })

  it('does not flip single-file visibility when cancellation arrives during final bookkeeping', async () => {
    const queries: string[] = []
    const client = makeClient(queries)
    let cancelledDuringBookkeeping = false
    const originalQuery = client.query
    client.query = vi.fn(async (sql: string | { text: string }, params?: unknown[]) => {
      const text = typeof sql === 'string' ? sql : sql.text
      const result = await originalQuery(sql, params)
      if (text === 'RELEASE SAVEPOINT cohort_summary') {
        cancelledDuringBookkeeping = true
      }
      return result
    })
    const messages: unknown[] = []

    await runVcfSingleFile(client, messages, {
      isCancellationRequested: () => cancelledDuringBookkeeping
    })

    expect(queries.some((query) => query.includes("import_status = 'ready'"))).toBe(false)
    expect(queries).toContain('ROLLBACK')
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: 'complete',
        result: expect.objectContaining({
          errors: [POSTGRES_IMPORT_CANCELLATION_MESSAGE]
        })
      })
    )
  })

  it('rolls back single-file visibility when cancellation arrives before publication commit', async () => {
    const queries: string[] = []
    const client = makeClient(queries)
    let cancelledBeforeCommit = false
    const originalQuery = client.query
    client.query = vi.fn(async (sql: string | { text: string }, params?: unknown[]) => {
      const text = typeof sql === 'string' ? sql : sql.text
      const result = await originalQuery(sql, params)
      if (text.startsWith('UPDATE') && text.includes("import_status = 'ready'")) {
        cancelledBeforeCommit = true
      }
      return result
    })
    const messages: unknown[] = []

    await runVcfSingleFile(client, messages, {
      isCancellationRequested: () => cancelledBeforeCommit
    })

    const readyIndex = queries.findIndex((query) => query.includes("import_status = 'ready'"))
    const firstTxnBoundaryAfterReady = queries.find(
      (query, index) => index > readyIndex && (query === 'COMMIT' || query === 'ROLLBACK')
    )
    expect(readyIndex).toBeGreaterThanOrEqual(0)
    expect(firstTxnBoundaryAfterReady).toBe('ROLLBACK')
    expect(
      queries.findIndex((query, index) => index > readyIndex && query === 'ROLLBACK')
    ).toBeGreaterThanOrEqual(0)
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: 'complete',
        result: expect.objectContaining({
          errors: [POSTGRES_IMPORT_CANCELLATION_MESSAGE]
        })
      })
    )
  })

  it('does not flip multi-file visibility when cancellation arrives during final bookkeeping', async () => {
    const queries: string[] = []
    const client = makeClient(queries)
    let cancelledDuringBookkeeping = false
    const originalQuery = client.query
    client.query = vi.fn(async (sql: string | { text: string }, params?: unknown[]) => {
      const text = typeof sql === 'string' ? sql : sql.text
      const result = await originalQuery(sql, params)
      if (text === 'RELEASE SAVEPOINT cohort_summary') {
        cancelledDuringBookkeeping = true
      }
      return result
    })
    const messages: unknown[] = []

    await runImport(
      {
        createClient: () => client as never,
        detectFormat: async () => ({ format: 'vcf', caseKey: '' }) as never,
        createVcfMappedStream: async () => Readable.from([fakeVariant]) as never,
        createMapperPipeline: async () => Readable.from([]),
        statFile: () => ({ size: 0 }),
        isCancellationRequested: () => cancelledDuringBookkeeping
      },
      {
        type: 'start',
        client: { connectionString: 'postgres://x' },
        schema: 'public',
        mode: 'multi-file',
        caseName: 'VCF case',
        vcfOptions: { selectedSample: 'NA12878', genomeBuild: 'GRCh38' },
        files: [
          {
            filePath: '/tmp/a.vcf.gz',
            variantType: 'snv-indel',
            annotationFormat: null,
            caller: null
          }
        ]
      },
      (m) => messages.push(m)
    )

    expect(queries.some((query) => query.includes("import_status = 'ready'"))).toBe(false)
    expect(queries).toContain('ROLLBACK')
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: 'complete',
        result: expect.objectContaining({
          errors: [POSTGRES_IMPORT_CANCELLATION_MESSAGE]
        })
      })
    )
  })

  it('never deletes work when the atomic publication commit outcome is uncertain', async () => {
    const queries: string[] = []
    const base = makeClient(queries)
    let commitCount = 0
    const originalQuery = base.query
    base.query = vi.fn(async (sql: string | { text: string }, params?: unknown[]) => {
      const text = typeof sql === 'string' ? sql : sql.text
      if (text === 'COMMIT') {
        commitCount += 1
        if (commitCount === 2) {
          queries.push(text)
          throw new Error('connection lost while publishing')
        }
      }
      return originalQuery(sql, params)
    })
    const messages: unknown[] = []

    await runVcfSingleFile(base, messages)

    expect(queries.some((query) => query.includes("import_status = 'ready'"))).toBe(true)
    expect(queries.some((query) => query.includes('DELETE FROM "public"."variants_all"'))).toBe(
      false
    )
    expect(queries.some((query) => query.includes('DELETE FROM "public"."cases_all"'))).toBe(false)
    expect(messages).toContainEqual(
      expect.objectContaining({ type: 'error', message: 'connection lost while publishing' })
    )
  })

  it('preserves variant_count + rebuildVariantFrequencyForCase on summary failure', async () => {
    incrementalAddSpy.mockRejectedValueOnce(new Error('boom in incrementalAdd'))
    const queries: string[] = []
    const client = makeClient(queries)
    const messages: unknown[] = []
    await runVcfSingleFile(client, messages)

    // Bookkeeping committed: the variant_count UPDATE and the variant_frequency
    // rebuild ran before the savepoint and survive the savepoint rollback.
    expect(queries.find((q) => q.startsWith('UPDATE') && q.includes('variant_count'))).toBeDefined()
    expect(queries.find((q) => q.includes('"variant_frequency"'))).toBeDefined()

    // Savepoint opened, then rolled back; the outer transaction still committed.
    expect(queries).toContain('SAVEPOINT cohort_summary')
    expect(queries).toContain('ROLLBACK TO SAVEPOINT cohort_summary')
    expect(queries).not.toContain('RELEASE SAVEPOINT cohort_summary')
    expect(queries).toContain('COMMIT')

    // markStale stays inside the same publication transaction so readers see
    // either the old snapshot or the ready case plus its stale marker.
    expect(markStaleSpy).toHaveBeenCalledTimes(1)
    expect(markStaleSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'post_import_summary_failed_case_13' })
    )

    // Import still reports success — staleness lives in cohort_summary_state.
    const complete = messages.find(
      (m): m is { type: 'complete' } => (m as { type: string }).type === 'complete'
    )
    expect(complete).toBeDefined()
  })

  it('does not publish when summary maintenance and durable stale marking both fail', async () => {
    incrementalAddSpy.mockRejectedValueOnce(new Error('summary write failed'))
    markStaleSpy.mockRejectedValueOnce(new Error('stale marker failed'))
    const queries: string[] = []
    const client = makeClient(queries)
    const messages: unknown[] = []

    await runVcfSingleFile(client, messages)

    expect(queries).toContain('ROLLBACK TO SAVEPOINT cohort_summary')
    expect(queries.some((query) => query.includes("import_status = 'ready'"))).toBe(false)
    expect(queries.some((query) => query.includes('DELETE FROM "public"."cases_all"'))).toBe(true)
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: 'error',
        message: expect.stringMatching(/stale marker failed/)
      })
    )
  })

  it('ImportResult shape carries NO warnings field (Pass-4 HIGH #3)', async () => {
    incrementalAddSpy.mockRejectedValueOnce(new Error('boom'))
    const queries: string[] = []
    const client = makeClient(queries)
    const messages: unknown[] = []
    await runVcfSingleFile(client, messages)

    const complete = messages.find(
      (m): m is { type: 'complete'; result: Record<string, unknown> } =>
        (m as { type: string }).type === 'complete'
    )
    expect(complete).toBeDefined()
    expect(complete!.result).not.toHaveProperty('warnings')
    expect(Object.keys(complete!.result).sort()).toEqual(
      ['caseId', 'elapsed', 'errors', 'skipped', 'variantCount'].sort()
    )
  })
})
