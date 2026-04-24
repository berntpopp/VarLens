import { describe, expect, it, vi } from 'vitest'

import type { Case } from '../../../src/shared/types/database'

const seededRows = [
  {
    id: '3',
    name: 'Newest Case',
    file_path: '/data/newest.vcf.gz',
    file_size: '4096',
    variant_count: '42',
    created_at: '1714060802000',
    genome_build: 'GRCh38'
  },
  {
    id: '2',
    name: 'Middle Case',
    file_path: '/data/middle.vcf.gz',
    file_size: '2048',
    variant_count: '21',
    created_at: '1714060801000',
    genome_build: 'GRCh37'
  },
  {
    id: '1',
    name: 'Oldest Case',
    file_path: '/data/oldest.vcf.gz',
    file_size: '1024',
    variant_count: '0',
    created_at: '1714060800000',
    genome_build: 'GRCh38'
  }
] as const

const expectedCases: Case[] = [
  {
    id: 3,
    name: 'Newest Case',
    file_path: '/data/newest.vcf.gz',
    file_size: 4096,
    variant_count: 42,
    created_at: 1714060802000,
    genome_build: 'GRCh38'
  },
  {
    id: 2,
    name: 'Middle Case',
    file_path: '/data/middle.vcf.gz',
    file_size: 2048,
    variant_count: 21,
    created_at: 1714060801000,
    genome_build: 'GRCh37'
  },
  {
    id: 1,
    name: 'Oldest Case',
    file_path: '/data/oldest.vcf.gz',
    file_size: 1024,
    variant_count: 0,
    created_at: 1714060800000,
    genome_build: 'GRCh38'
  }
]

async function loadSubject(): Promise<{
  PostgresCaseListRepository: new (
    pool: { query: (sql: string) => Promise<{ rows: unknown[] }> },
    schema: string
  ) => {
    listCases(): Promise<Case[]>
  }
}> {
  const module =
    await import('../../../src/main/storage/postgres/PostgresCaseListRepository').catch(() => null)

  expect(module).not.toBeNull()
  return module!
}

describe('PostgresCaseListRepository', () => {
  it('lists cases in created_at descending order using the shared Case shape', async () => {
    const { PostgresCaseListRepository } = await loadSubject()
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: seededRows
      })
    }

    const repository = new PostgresCaseListRepository(pool, 'phase3_cases')

    await expect(repository.listCases()).resolves.toStrictEqual(expectedCases)
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM "phase3_cases"."cases"'))
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at DESC'))
  })

  it('quotes the schema identifier before building the cases query', async () => {
    const { PostgresCaseListRepository } = await loadSubject()
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: []
      })
    }

    const repository = new PostgresCaseListRepository(pool, 'phase3"cases')

    await repository.listCases()

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM "phase3""cases"."cases"'))
  })
})
