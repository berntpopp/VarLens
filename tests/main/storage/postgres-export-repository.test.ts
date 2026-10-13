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
    // calls[0] lifts the statement timeout for the stream (#490).
    const queryArg = query.mock.calls[1]?.[0] as
      { cursor?: { text?: string; values?: unknown[] } } | undefined
    expect(queryArg?.cursor?.text).toContain('WHERE v.case_id = $1')
    expect(queryArg?.cursor?.text).toContain('v.gene_symbol ILIKE')
    expect(queryArg?.cursor?.values?.map(String)).toEqual(['5', '%BRCA1%'])
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('only the export stream looks up annotations; the shortlist rows stay plain (#574)', async () => {
    const texts: string[] = []
    const query = vi.fn((arg: unknown) => {
      const text = (arg as { cursor?: { text?: string } })?.cursor?.text
      if (text !== undefined) texts.push(text)
      return {
        async *[Symbol.asyncIterator]() {
          yield { id: '1', chr: '1', pos: '123', ref: 'A', alt: 'G' }
        }
      }
    })
    const repo = new PostgresExportRepository(
      { connect: vi.fn(async () => ({ query, release: vi.fn() })) } as never,
      'public'
    )
    const plain = []
    for await (const row of repo.streamVariantRows({ case_id: 5 })) plain.push(row)
    const exported = []
    for await (const row of repo.streamVariantExportRows({ case_id: 5 })) exported.push(row)

    expect(texts[0]).not.toContain('case_variant_annotations')
    expect(plain[0]).not.toHaveProperty('acmg_classification')
    expect(texts[1]).toContain('case_variant_annotations')
    expect(exported[0]).toHaveProperty('acmg_classification', null)
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
