import { describe, expect, it, vi } from 'vitest'

import { PostgresAvailableBuildsRepository } from '../../../src/main/storage/postgres/PostgresAvailableBuildsRepository'

describe('PostgresAvailableBuildsRepository', () => {
  it('returns available genome builds with numeric counts and null-build fallback', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        { build: 'GRCh38', case_count: '4' },
        { build: 'GRCh37', case_count: 1 }
      ]
    })
    const repository = new PostgresAvailableBuildsRepository({ query } as never, 'public')

    await expect(repository.getAvailableGenomeBuilds()).resolves.toEqual([
      { build: 'GRCh38', caseCount: 4 },
      { build: 'GRCh37', caseCount: 1 }
    ])
  })

  it('quotes the configured schema and groups by the normalized genome build', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ build: 'GRCh38', case_count: 1 }]
    })
    const repository = new PostgresAvailableBuildsRepository({ query } as never, 'tenant"schema')

    await repository.getAvailableGenomeBuilds()

    expect(query).toHaveBeenCalledTimes(1)
    const sql = query.mock.calls[0][0] as string
    expect(sql).toContain('"tenant""schema"."cases"')
    expect(sql).toContain("COALESCE(genome_build, 'GRCh38') AS build")
    expect(sql).toContain('GROUP BY 1')
    expect(sql).toContain('ORDER BY case_count DESC')
  })
})
