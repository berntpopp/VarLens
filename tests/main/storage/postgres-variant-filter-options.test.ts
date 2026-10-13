import { describe, expect, it, vi } from 'vitest'

import { PostgresVariantReadRepository } from '../../../src/main/storage/postgres/PostgresVariantReadRepository'

// getColumnMeta / getFilterOptions route through runNamed / runNamedDynamic,
// which call pool.query with a { name, text, values } spec object rather than
// positional (text, values). Extract the SQL text regardless of call shape.
function sqlTextOf(arg: unknown): string {
  if (typeof arg === 'string') return arg
  return (arg as { text?: string }).text ?? ''
}

describe('PostgresVariantReadRepository filter metadata', () => {
  it('reads per-case filter options from cohort_column_meta and reshapes to SQLite shape', async () => {
    // C4 Step 3: getFilterOptions(caseId) issues a single cohort_column_meta
    // read. JSONB columns come back from node-pg already parsed.
    const query = vi.fn(async () => ({
      rows: [
        {
          column_name: 'chr',
          min_value: null,
          max_value: null,
          distinct_count: 2,
          distinct_values: ['1', '2']
        },
        {
          column_name: 'cadd',
          min_value: 10,
          max_value: 35,
          distinct_count: 2,
          distinct_values: null
        },
        {
          column_name: 'gnomad_af',
          min_value: 0.01,
          max_value: 0.2,
          distinct_count: 2,
          distinct_values: null
        },
        {
          column_name: 'consequence',
          min_value: null,
          max_value: null,
          distinct_count: 1,
          distinct_values: ['HIGH']
        },
        {
          column_name: 'func',
          min_value: null,
          max_value: null,
          distinct_count: 1,
          distinct_values: ['stop_gained']
        },
        {
          column_name: 'clinvar',
          min_value: null,
          max_value: null,
          distinct_count: 1,
          distinct_values: ['Pathogenic']
        }
      ]
    }))
    const repo = new PostgresVariantReadRepository({ query } as never, 'public')

    const options = await repo.getFilterOptions(1)

    expect(query).toHaveBeenCalledTimes(1)
    const sql = sqlTextOf(query.mock.calls[0][0])
    expect(sql).toContain('"public"."cohort_column_meta"')
    expect(sql).toContain('WHERE case_id = $1')
    expect((query.mock.calls[0][0] as { values: unknown[] }).values).toEqual([1])

    expect(options.consequences).toStrictEqual(['HIGH'])
    expect(options.funcs).toStrictEqual(['stop_gained'])
    expect(options.clinvars).toStrictEqual(['Pathogenic'])
    expect(options.minCadd).toBe(10)
    expect(options.maxCadd).toBe(35)
    expect(options.minGnomadAf).toBe(0.01)
    expect(options.maxGnomadAf).toBe(0.2)
    // columnMeta mirrors SQLite getAllColumnMetas — base columns only, in the
    // canonical order; extension columns are not part of the per-case cache.
    expect(options.columnMeta.map((meta) => meta.key)).toStrictEqual([
      'chr',
      'pos',
      'gene_symbol',
      'omim_mim_number',
      'func',
      'consequence',
      'transcript',
      'cdna',
      'aa_change',
      'gt_num',
      'gnomad_af',
      'cadd',
      'qual',
      'hpo_sim_score',
      'clinvar',
      'moi',
      'variant_type',
      'end_pos',
      'sv_type',
      'sv_length',
      'caller'
    ])
    expect(options.columnMeta).toContainEqual({
      key: 'cadd',
      dataType: 'numeric',
      distinctCount: 2,
      min: 10,
      max: 35
    })
    expect(options.columnMeta).toContainEqual({
      key: 'consequence',
      dataType: 'text',
      distinctCount: 1,
      distinctValues: ['HIGH']
    })
    // A column with no stored row degrades to an empty-distinct entry.
    expect(options.columnMeta).toContainEqual({
      key: 'moi',
      dataType: 'text',
      distinctCount: 0
    })
    // end_pos is categorical on the write side (no min/max materialised);
    // sv_length carries its unsigned bounds (#573), numeric like on SQLite.
    const metaByKey = new Map(options.columnMeta.map((meta) => [meta.key, meta]))
    expect(metaByKey.get('end_pos')?.dataType).toBe('text')
    expect(metaByKey.get('sv_length')?.dataType).toBe('numeric')
  })

  it('reads single-case numeric column metadata from cohort_column_meta', async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          column_name: 'cadd',
          min_value: 1,
          max_value: 99,
          distinct_count: 3,
          distinct_values: null
        }
      ]
    }))
    const repo = new PostgresVariantReadRepository({ query } as never, 'public')

    await expect(repo.getColumnMeta({ caseId: 1 }, 'cadd')).resolves.toStrictEqual({
      key: 'cadd',
      dataType: 'numeric',
      distinctCount: 3,
      min: 1,
      max: 99
    })
    const sql = sqlTextOf(query.mock.calls[0][0])
    expect(sql).toContain('"public"."cohort_column_meta"')
    expect(sql).toContain('column_name = $2')
    expect((query.mock.calls[0][0] as { values: unknown[] }).values).toEqual([1, 'cadd'])
  })

  it('reads single-case categorical column metadata from cohort_column_meta', async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          column_name: 'consequence',
          min_value: null,
          max_value: null,
          distinct_count: 1,
          distinct_values: ['HIGH']
        }
      ]
    }))
    const repo = new PostgresVariantReadRepository({ query } as never, 'public')

    await expect(repo.getColumnMeta({ caseId: 1 }, 'consequence')).resolves.toStrictEqual({
      key: 'consequence',
      dataType: 'text',
      distinctCount: 1,
      distinctValues: ['HIGH']
    })
  })

  it('returns an empty entry when no cohort_column_meta row exists for the case column', async () => {
    const query = vi.fn(async () => ({ rows: [] }))
    const repo = new PostgresVariantReadRepository({ query } as never, 'public')

    await expect(repo.getColumnMeta({ caseId: 9 }, 'consequence')).resolves.toStrictEqual({
      key: 'consequence',
      dataType: 'text',
      distinctCount: 0
    })
  })

  it('keeps single-case extension column metadata live-aggregating', async () => {
    const query = vi.fn(async () => ({
      rows: [{ distinct_count: '2', min: '4', max: '12' }]
    }))
    const repo = new PostgresVariantReadRepository({ query } as never, 'public')

    await expect(repo.getColumnMeta({ caseId: 1 }, 'sv.support')).resolves.toMatchObject({
      key: 'sv.support',
      dataType: 'numeric',
      distinctCount: 2,
      min: 4,
      max: 12
    })

    const sql = sqlTextOf(query.mock.calls[0][0])
    expect(sql).toContain('"variant_sv" sv')
    expect(sql).not.toContain('cohort_column_meta')
  })

  it('keeps multi-case base column metadata live-aggregating', async () => {
    const query = vi.fn(async (arg: unknown) => {
      const sql = sqlTextOf(arg)
      if (sql.includes('COUNT(DISTINCT')) return { rows: [{ distinct_count: '1' }] }
      return { rows: [{ value: 'HIGH' }] }
    })
    const repo = new PostgresVariantReadRepository({ query } as never, 'public')

    await expect(repo.getColumnMeta({ caseIds: [1, 2] }, 'consequence')).resolves.toStrictEqual({
      key: 'consequence',
      dataType: 'text',
      distinctCount: 1,
      distinctValues: ['HIGH']
    })
    const sql = sqlTextOf(query.mock.calls[0][0])
    expect(sql).toContain('ANY($1::bigint[])')
    expect(sql).not.toContain('cohort_column_meta')
  })

  it('uses extension joins for extension column metadata', async () => {
    const query = vi.fn(async () => ({
      rows: [{ distinct_count: '2', min: '4', max: '12' }]
    }))
    const repo = new PostgresVariantReadRepository({ query } as never, 'public')

    await expect(repo.getColumnMeta({ caseIds: [1, 2] }, 'sv.support')).resolves.toMatchObject({
      key: 'sv.support',
      dataType: 'numeric',
      distinctCount: 2,
      min: 4,
      max: 12
    })

    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('"variant_sv" sv'),
        values: [[1, 2]]
      })
    )
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('ANY($1::bigint[])'),
        values: [[1, 2]]
      })
    )
  })
})
