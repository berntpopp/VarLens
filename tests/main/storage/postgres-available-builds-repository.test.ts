import { describe, expect, it, vi } from 'vitest'

import { PostgresAvailableBuildsRepository } from '../../../src/main/storage/postgres/PostgresAvailableBuildsRepository'

describe('PostgresAvailableBuildsRepository', () => {
  it('returns available genome builds with numeric counts and null-build fallback', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        { build: 'GRCh38', case_count: '3' },
        { build: null, case_count: 1 }
      ]
    })
    const repository = new PostgresAvailableBuildsRepository({ query } as never, 'public')

    await expect(repository.getAvailableGenomeBuilds()).resolves.toEqual([
      { build: 'GRCh38', caseCount: 3 },
      { build: 'GRCh38', caseCount: 1 }
    ])
  })

  it('quotes the configured schema and groups by the stored genome build', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ build: 'GRCh38', case_count: 1 }]
    })
    const repository = new PostgresAvailableBuildsRepository({ query } as never, 'tenant"schema')

    await repository.getAvailableGenomeBuilds()

    expect(query).toHaveBeenCalledTimes(1)
    const sql = query.mock.calls[0][0] as string
    expect(sql).toContain('"tenant""schema"."cases"')
    expect(sql).toContain('GROUP BY genome_build')
    expect(sql).toContain('ORDER BY case_count DESC')
  })
})
