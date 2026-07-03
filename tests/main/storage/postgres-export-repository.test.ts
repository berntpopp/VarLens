import { describe, expect, it, vi } from 'vitest'

import { PostgresExportRepository } from '../../../src/main/storage/postgres/PostgresExportRepository'

describe('PostgresExportRepository', () => {
  it('builds a parameterized streaming export query for variants', async () => {
    const release = vi.fn()
    const query = vi.fn(() => ({
      async *[Symbol.asyncIterator]() {
        yield { id: '1', chr: '1', pos: '123', ref: 'A', alt: 'G' }
      }
    }))
    const repo = new PostgresExportRepository(
      { connect: vi.fn(async () => ({ query, release })) } as never,
      'public'
    )

    const rows = []
    for await (const row of repo.streamVariantRows({ case_id: 5, gene_symbol: 'BRCA1' })) {
      rows.push(row)
    }

    expect(rows).toHaveLength(1)
    const queryArg = query.mock.calls[0]?.[0] as
      { cursor?: { text?: string; values?: unknown[] } } | undefined
    expect(queryArg?.cursor?.text).toContain('WHERE v.case_id = $1')
    expect(queryArg?.cursor?.text).toContain('v.gene_symbol ILIKE')
    expect(queryArg?.cursor?.values?.map(String)).toEqual(['5', '%BRCA1%'])
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('rejects unsupported column filters before opening a streaming client', async () => {
    const connect = vi.fn()
    const repo = new PostgresExportRepository({ connect } as never, 'public')

    await expect(async () => {
      await repo
        .streamVariantRows({
          case_id: 5,
          column_filters: { 'sv.does_not_exist': { operator: '>', value: 1 } }
        })
        .next()
    }).rejects.toThrow('Unsupported PostgreSQL column filter(s): sv.does_not_exist')
    expect(connect).not.toHaveBeenCalled()
  })
})
