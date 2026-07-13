import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  PostgresJsonImportRepository,
  rebuildVariantFrequencyForCase
} from '../../../src/main/storage/postgres/PostgresJsonImportRepository'
import { UniqueConstraintError } from '../../../src/main/database/errors'

// ---------------------------------------------------------------------------
// Helpers — client-shape harness (pool.connect never called by the repo)
// ---------------------------------------------------------------------------

type QueryReturn = { rows: unknown[]; rowCount?: number } | Error

function makeClient(rowsByCall: QueryReturn[] = []) {
  const query = vi.fn(async () => {
    const next = rowsByCall.shift()
    if (next instanceof Error) throw next
    return next ?? { rows: [], rowCount: 0 }
  })
  return { query }
}

type ClientMock = ReturnType<typeof makeClient>

/** A pool that throws if connect() is called — enforces the no-pool-in-repo contract. */
function makeForbiddenPool() {
  return {
    connect: vi.fn(async () => {
      throw new Error('writeJsonImport must not call pool.connect')
    })
  }
}

function queryCalls(client: ClientMock): Array<{ sql: string; params: unknown[] }> {
  return client.query.mock.calls.map((call) => {
    const [sql, params] = call as [unknown, unknown?]
    return {
      sql: typeof sql === 'string' ? sql : '',
      params: Array.isArray(params) ? params : []
    }
  })
}

function findCall(
  client: ClientMock,
  matcher: RegExp | ((sql: string) => boolean)
): { sql: string; params: unknown[] } | undefined {
  return queryCalls(client).find((call) => {
    if (call.sql === '') return false
    if (matcher instanceof RegExp) return matcher.test(call.sql)
    return matcher(call.sql)
  })
}

function findAllCalls(
  client: ClientMock,
  matcher: RegExp | ((sql: string) => boolean)
): Array<{ sql: string; params: unknown[] }> {
  return queryCalls(client).filter((call) => {
    if (call.sql === '') return false
    if (matcher instanceof RegExp) return matcher.test(call.sql)
    return matcher(call.sql)
  })
}

const baseRequest = {
  filePath: '/tmp/simple-format.json',
  fileName: 'simple-format.json',
  caseName: 'Imported JSON',
  fileSize: 100,
  genomeBuild: 'GRCh38',
  importFileType: 'simple' as const
}

// ---------------------------------------------------------------------------
// writeJsonImport — transaction-scoped API
// ---------------------------------------------------------------------------

describe('PostgresJsonImportRepository.writeJsonImport', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-24T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('issues no transaction-lifecycle SQL — caller owns BEGIN/COMMIT/ROLLBACK', async () => {
    const queries: string[] = []
    const client = {
      query: async (sql: string | { text: string }) => {
        const text = typeof sql === 'string' ? sql : sql.text
        queries.push(text)
        if (text.startsWith('SELECT id FROM')) return { rows: [] }
        if (text.startsWith('INSERT INTO') && text.includes('"cases"')) {
          return { rows: [{ id: 42 }] }
        }
        return { rows: [] }
      }
    }
    const repo = new PostgresJsonImportRepository(makeForbiddenPool() as never, 'public')

    await repo.writeJsonImport(client as never, baseRequest, async () => {
      // empty writer — exercises only schema-level SQL
    })

    expect(queries).not.toContain('BEGIN')
    expect(queries).not.toContain('COMMIT')
    expect(queries).not.toContain('ROLLBACK')
    // Frequency rebuild has moved to the caller (executor).
    expect(queries.join('\n')).not.toMatch(/INSERT INTO[\s\S]+variant_frequency/)
  })

  it('creates case row, stores provenance, returns caseId and variantCount', async () => {
    const client = makeClient([
      { rows: [] }, // duplicate check SELECT
      { rows: [{ id: '4' }] }, // INSERT cases RETURNING id
      { rows: [{ id: '10' }, { id: '11' }] }, // variants batch INSERT
      { rows: [] }, // case_data_info upsert
      { rows: [] } // UPDATE cases variant_count
    ])
    const repo = new PostgresJsonImportRepository(makeForbiddenPool() as never, 'public')

    const result = await repo.writeJsonImport(client as never, baseRequest, async (session) => {
      await session.insertVariantBatch([
        { chr: '1', pos: 12345, ref: 'A', alt: 'G', gene_symbol: 'BRCA1', consequence: 'HIGH' },
        { chr: '7', pos: 67890, ref: 'C', alt: 'T', gene_symbol: 'CFTR', consequence: 'MODERATE' }
      ])
    })

    expect(result).toStrictEqual({ caseId: 4, variantCount: 2 })

    // Duplicate check
    const dupCheck = findCall(
      client,
      /SELECT\s+id\s+FROM\s+"public"\."cases"\s+WHERE\s+name\s*=\s*\$1/i
    )
    expect(dupCheck).toBeDefined()
    expect(dupCheck?.params).toStrictEqual(['Imported JSON'])

    // Case insert RETURNING id
    const caseInsert = findCall(client, /INSERT INTO\s+"public"\."cases"[\s\S]+RETURNING\s+id/i)
    expect(caseInsert).toBeDefined()

    // Variant batch uses jsonb_to_recordset
    const variantBatch = findCall(
      client,
      /INSERT INTO\s+"public"\."variants"[\s\S]+jsonb_to_recordset\(\$1::jsonb\)/i
    )
    expect(variantBatch).toBeDefined()

    // case_data_info upsert
    const caseDataInfo = findCall(
      client,
      /INSERT INTO\s+"public"\."case_data_info"[\s\S]+ON CONFLICT\s*\(\s*case_id\s*\)\s+DO UPDATE/i
    )
    expect(caseDataInfo).toBeDefined()

    // UPDATE variant_count
    const updateCount = findCall(
      client,
      /UPDATE\s+"public"\."cases"\s+SET\s+variant_count\s*=\s*\$1\s+WHERE\s+id\s*=\s*\$2/i
    )
    expect(updateCount).toBeDefined()
    expect(updateCount?.params).toStrictEqual([2, 4])
  })

  it('throws Duplicate case name when case already exists', async () => {
    const client = makeClient([
      { rows: [{ id: '99' }] } // duplicate check SELECT returns existing row
    ])
    const repo = new PostgresJsonImportRepository(makeForbiddenPool() as never, 'public')

    const error = await repo
      .writeJsonImport(client as never, baseRequest, async () => {
        /* not invoked */
      })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(UniqueConstraintError)
    expect(error).toMatchObject({ message: "case 'Imported JSON' already exists" })
  })

  it('propagates insert failure to the caller', async () => {
    const client = makeClient([
      { rows: [] }, // duplicate check
      { rows: [{ id: '4' }] }, // case insert
      new Error('boom') // variant batch blows up
    ])
    const repo = new PostgresJsonImportRepository(makeForbiddenPool() as never, 'public')

    await expect(
      repo.writeJsonImport(client as never, baseRequest, async (session) => {
        await session.insertVariantBatch([
          { chr: '1', pos: 1, ref: 'A', alt: 'G', gene_symbol: 'X', consequence: 'LOW' }
        ])
      })
    ).rejects.toThrow(/boom/)
  })

  it('base variant batch uses jsonb_to_recordset with single JSON parameter', async () => {
    const client = makeClient([
      { rows: [] }, // duplicate check
      { rows: [{ id: '4' }] }, // case insert
      { rows: [{ id: '10' }, { id: '11' }] }, // variant batch insert
      { rows: [] }, // case_data_info
      { rows: [] } // update variant_count
    ])
    const repo = new PostgresJsonImportRepository(makeForbiddenPool() as never, 'public')

    await repo.writeJsonImport(client as never, baseRequest, async (session) => {
      await session.insertVariantBatch([
        { chr: '1', pos: 1, ref: 'A', alt: 'G' },
        { chr: '2', pos: 2, ref: 'C', alt: 'T' }
      ])
    })

    const variantBatch = findCall(
      client,
      /INSERT INTO\s+"public"\."variants"[\s\S]+jsonb_to_recordset\(\$1::jsonb\)/i
    )
    expect(variantBatch).toBeDefined()
    // Exactly one bound parameter (the JSON payload)
    expect(variantBatch?.params).toHaveLength(1)
    // Parameter is a JSON string
    const payload = variantBatch?.params[0]
    expect(typeof payload).toBe('string')
    const parsed = JSON.parse(payload as string)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toHaveLength(2)
  })

  it('extension-bearing rows are inserted one at a time (RETURNING id strategy)', async () => {
    const client = makeClient([
      { rows: [] }, // duplicate check
      { rows: [{ id: '4' }] }, // case insert
      // Row 1 has extension -> expected single-row INSERT ... RETURNING id
      { rows: [{ id: '10' }] },
      // variant_transcripts insert
      { rows: [] },
      { rows: [] }, // case_data_info
      { rows: [] } // update variant_count
    ])
    const repo = new PostgresJsonImportRepository(makeForbiddenPool() as never, 'public')

    await repo.writeJsonImport(client as never, baseRequest, async (session) => {
      await session.insertVariantBatch([
        {
          chr: '1',
          pos: 100,
          ref: 'A',
          alt: 'G',
          gene_symbol: 'BRCA1',
          _transcripts: [{ transcript_id: 'ENST00000001', gene_symbol: 'BRCA1', is_selected: 1 }]
        }
      ])
    })

    const baseInserts = findAllCalls(client, /INSERT INTO\s+"public"\."variants"/i)
    expect(baseInserts.length).toBeGreaterThan(0)

    const allVariantInserts = baseInserts
    // Strategy A: batched with import_ordinal OR Strategy B: one-at-a-time RETURNING id
    const hasOrdinalStrategy = allVariantInserts.some((call) => {
      if (call.params.length !== 1) return false
      try {
        const parsed = JSON.parse(String(call.params[0])) as Array<Record<string, unknown>>
        return parsed.every((row) => typeof row.import_ordinal === 'number')
      } catch {
        return false
      }
    })
    const hasOneAtATimeStrategy = allVariantInserts.some(
      (call) => /RETURNING\s+id/i.test(call.sql) && call.params.length === 1
    )

    expect(hasOrdinalStrategy || hasOneAtATimeStrategy).toBe(true)
  })

  it('extension table inserts use jsonb_to_recordset with variant_id populated', async () => {
    const client = makeClient([
      { rows: [] }, // duplicate check
      { rows: [{ id: '4' }] }, // case insert
      // extension-bearing variant inserted one-at-a-time
      { rows: [{ id: '10' }] },
      { rows: [] }, // variant_transcripts jsonb_to_recordset
      { rows: [] }, // case_data_info
      { rows: [] } // update variant_count
    ])
    const repo = new PostgresJsonImportRepository(makeForbiddenPool() as never, 'public')

    await repo.writeJsonImport(client as never, baseRequest, async (session) => {
      await session.insertVariantBatch([
        {
          chr: '1',
          pos: 100,
          ref: 'A',
          alt: 'G',
          _transcripts: [
            { transcript_id: 'ENST00000001', gene_symbol: 'BRCA1', is_selected: 1 },
            { transcript_id: 'ENST00000002', gene_symbol: 'BRCA1', is_selected: 0 }
          ]
        }
      ])
    })

    const transcriptInsert = findCall(
      client,
      /INSERT INTO\s+"public"\."variant_transcripts"[\s\S]+jsonb_to_recordset\(\$1::jsonb\)/i
    )
    expect(transcriptInsert).toBeDefined()
    expect(transcriptInsert?.params).toHaveLength(1)
    const parsed = JSON.parse(String(transcriptInsert?.params[0])) as Array<Record<string, unknown>>
    expect(parsed).toHaveLength(2)
    for (const row of parsed) {
      expect(row.variant_id).toBe(10)
      expect(typeof row.transcript_id).toBe('string')
    }
  })

  it('case_data_info only uses Phase 6 columns', async () => {
    const client = makeClient([
      { rows: [] }, // duplicate
      { rows: [{ id: '4' }] }, // case insert
      { rows: [{ id: '10' }] }, // variant batch
      { rows: [] }, // case_data_info
      { rows: [] } // update variant_count
    ])
    const repo = new PostgresJsonImportRepository(makeForbiddenPool() as never, 'public')

    await repo.writeJsonImport(client as never, baseRequest, async (session) => {
      await session.insertVariantBatch([{ chr: '1', pos: 1, ref: 'A', alt: 'G' }])
    })

    const caseDataInfoInsert = findCall(client, /INSERT INTO\s+"public"\."case_data_info"/i)
    expect(caseDataInfoInsert).toBeDefined()
    const sql = caseDataInfoInsert?.sql ?? ''

    // Forbid columns that aren't in 11-phase6-case-metadata.sql
    expect(sql).not.toMatch(/\bimport_date\b/i)
    expect(sql).not.toMatch(/\bimported_at\b/i)

    // Whitelist: must only reference known Phase 6 columns + created_at/updated_at
    const phase6Columns = [
      'case_id',
      'import_file_name',
      'import_file_type',
      'platform',
      'platform_details',
      'af_filter',
      'gene_list_filter',
      'region_filter',
      'quality_filter',
      'data_notes',
      'created_at',
      'updated_at',
      'gene_list_id',
      'region_file_id'
    ]

    // Extract INSERT column list: "(col, col, col)"
    const colListMatch = sql.match(/INSERT INTO\s+"public"\."case_data_info"\s*\(([^)]+)\)/i)
    expect(colListMatch).not.toBeNull()
    const columns = (colListMatch?.[1] ?? '')
      .split(',')
      .map((c) => c.trim().replace(/"/g, ''))
      .filter((c) => c !== '')
    for (const col of columns) {
      expect(phase6Columns).toContain(col)
    }
    // Must at minimum include case_id, import_file_name, import_file_type, created_at, updated_at
    for (const required of [
      'case_id',
      'import_file_name',
      'import_file_type',
      'created_at',
      'updated_at'
    ]) {
      expect(columns).toContain(required)
    }
  })

  it('search_document is populated by generated column (not in INSERT column list)', async () => {
    const client = makeClient([
      { rows: [] }, // dup
      { rows: [{ id: '4' }] }, // case insert
      { rows: [{ id: '10' }] }, // variant batch
      { rows: [] }, // case_data_info
      { rows: [] } // update count
    ])
    const repo = new PostgresJsonImportRepository(makeForbiddenPool() as never, 'public')

    await repo.writeJsonImport(client as never, baseRequest, async (session) => {
      await session.insertVariantBatch([
        { chr: '1', pos: 1, ref: 'A', alt: 'G', gene_symbol: 'BRCA1' }
      ])
    })

    const variantInsert = findCall(client, /INSERT INTO\s+"public"\."variants"/i)
    expect(variantInsert).toBeDefined()
    // Extract INSERT column list
    const colListMatch = variantInsert?.sql.match(
      /INSERT INTO\s+"public"\."variants"\s*\(([^)]+)\)/i
    )
    expect(colListMatch).not.toBeNull()
    const columns = (colListMatch?.[1] ?? '').split(',').map((c) => c.trim().replace(/"/g, ''))
    expect(columns).not.toContain('search_document')
  })

  it('two batches stream through same client without accumulating the entire file', async () => {
    const client = makeClient([
      { rows: [] }, // dup
      { rows: [{ id: '4' }] }, // case insert
      { rows: [{ id: '10' }, { id: '11' }] }, // batch 1
      { rows: [{ id: '12' }, { id: '13' }] }, // batch 2
      { rows: [] }, // case_data_info
      { rows: [] } // update count
    ])
    const repo = new PostgresJsonImportRepository(makeForbiddenPool() as never, 'public')

    const batchA = Array.from({ length: 2 }, (_, i) => ({
      chr: '1',
      pos: i + 1,
      ref: 'A',
      alt: 'G'
    }))
    const batchB = Array.from({ length: 2 }, (_, i) => ({
      chr: '2',
      pos: i + 1,
      ref: 'C',
      alt: 'T'
    }))

    await repo.writeJsonImport(client as never, baseRequest, async (session) => {
      await session.insertVariantBatch(batchA)
      await session.insertVariantBatch(batchB)
    })

    // Two separate variant batch INSERTs (no coalescing)
    const variantBatches = findAllCalls(
      client,
      /INSERT INTO\s+"public"\."variants"[\s\S]+jsonb_to_recordset/i
    )
    expect(variantBatches).toHaveLength(2)

    // No BEGIN/COMMIT in the query list — caller owns lifecycle
    const calls = queryCalls(client)
    expect(calls.some((c) => c.sql === 'BEGIN')).toBe(false)
    expect(calls.some((c) => c.sql === 'COMMIT')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// rebuildVariantFrequencyForCase — standalone exported helper
// ---------------------------------------------------------------------------

describe('rebuildVariantFrequencyForCase', () => {
  it('runs the case-scoped frequency upsert without opening or closing a transaction', async () => {
    const queries: { text: string; params?: unknown[] }[] = []
    const client = {
      query: async (sql: string, params?: unknown[]) => {
        queries.push({ text: sql, params })
        return { rows: [] }
      }
    }

    await rebuildVariantFrequencyForCase(client as never, 'public', 99)

    expect(queries).toHaveLength(1)
    expect(queries[0].text).toContain('INSERT INTO "public"."variant_frequency"')
    expect(queries[0].text).toContain('WHERE case_id = $1')
    expect(queries[0].text).toContain('GROUP BY chr, pos, ref, alt')
    expect(queries[0].text).toContain('ON CONFLICT (coord_hash)')
    expect(queries[0].text).not.toContain('ON CONFLICT (chr, pos, ref, alt)')
    expect(queries[0].text).toMatch(/DO UPDATE\s+SET case_count/)
    expect(queries[0].params).toEqual([99])
  })

  it('uses quoted schema name correctly', async () => {
    const queries: { text: string }[] = []
    const client = {
      query: async (sql: string) => {
        queries.push({ text: sql })
        return { rows: [] }
      }
    }

    await rebuildVariantFrequencyForCase(client as never, 'myschema', 7)

    expect(queries[0].text).toContain('"myschema"."variant_frequency"')
    expect(queries[0].text).toContain('"myschema"."variants"')
    expect(queries[0].text).toContain('"myschema"."variant_frequency".case_count')
  })
})
