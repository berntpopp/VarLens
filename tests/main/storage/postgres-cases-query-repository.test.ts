import { describe, expect, it, vi } from 'vitest'

import { PostgresCasesQueryRepository } from '../../../src/main/storage/postgres/PostgresCasesQueryRepository'

describe('PostgresCasesQueryRepository', () => {
  it('queries cases with cohorts, metadata, pagination, and total count', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: '3',
              name: 'Newest Case',
              file_path: '/data/newest.vcf.gz',
              file_size: '4096',
              variant_count: '42',
              created_at: '1714060802000',
              genome_build: 'GRCh38',
              affected_status: 'affected',
              sex: 'female',
              cohort_names: ['rare disease'],
              cohort_ids: ['7']
            }
          ]
        })
        .mockResolvedValueOnce({
          rows: [{ total_count: 12 }]
        })
    }
    const repository = new PostgresCasesQueryRepository(pool as never, 'phase4_cases')

    const result = await repository.queryCases({
      limit: 10,
      offset: 20,
      search_term: 'new',
      sort_by: 'name',
      sort_order: 'asc'
    })

    expect(result).toStrictEqual({
      data: [
        {
          id: 3,
          name: 'Newest Case',
          file_path: '/data/newest.vcf.gz',
          file_size: 4096,
          variant_count: 42,
          created_at: 1714060802000,
          genome_build: 'GRCh38',
          affected_status: 'affected',
          sex: 'female',
          cohort_names: ['rare disease'],
          cohort_ids: [7]
        }
      ],
      total_count: 12
    })
    expect(pool.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FROM "phase4_cases"."cases" c'),
      ['%new%', 10, 20]
    )
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('COUNT(*)::int AS total_count'),
      ['%new%']
    )
    const rowsSql = String(pool.query.mock.calls[0]?.[0])
    const groupBySql = rowsSql.slice(rowsSql.indexOf('GROUP BY'), rowsSql.indexOf('ORDER BY'))
    for (const projectedCaseColumn of [
      'c.id',
      'c.name',
      'c.file_path',
      'c.file_size',
      'c.variant_count',
      'c.created_at',
      'c.genome_build'
    ]) {
      expect(groupBySql).toContain(projectedCaseColumn)
    }
  })

  it('runs the no-filter count through the named (prepared) path', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total_count: 0 }] })
    }
    const repository = new PostgresCasesQueryRepository(pool as never, 'public')

    await repository.queryCases({ limit: 25, offset: 0 })

    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        name: expect.stringContaining('cases:count_all:v1'),
        text: expect.stringContaining('COUNT(*)::int AS total_count'),
        values: []
      })
    )
  })

  it('filters postgres cases by cohort ids', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total_count: 0 }] })
    }
    const repository = new PostgresCasesQueryRepository(pool as never, 'public')

    await repository.queryCases({
      limit: 25,
      offset: 0,
      cohort_ids: [1, 2]
    })

    expect(pool.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('ccl_filter.cohort_id = ANY'),
      [[1, 2], 25, 0]
    )
  })

  it('filters postgres cases by hpo ids', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total_count: 0 }] })
    }
    const repository = new PostgresCasesQueryRepository(pool as never, 'public')

    await repository.queryCases({
      limit: 25,
      offset: 0,
      hpo_ids: ['HP:0001250']
    })

    expect(pool.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('cht_filter.hpo_id = ANY'),
      [['HP:0001250'], 25, 0]
    )
  })
})
