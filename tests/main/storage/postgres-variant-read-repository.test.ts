import { describe, expect, it, vi } from 'vitest'

import {
  buildPostgresVariantQueryParts,
  PostgresVariantReadRepository,
  toPrefixTsQueryForTest
} from '../../../src/main/storage/postgres/PostgresVariantReadRepository'

describe('PostgresVariantReadRepository', () => {
  it('returns variant type counts with bigint strings normalized', async () => {
    const pool = {
      query: vi.fn().mockResolvedValueOnce({
        rows: [
          { variant_type: 'snv', count: '2' },
          { variant_type: 'sv', count: '1' }
        ]
      })
    }
    const repository = new PostgresVariantReadRepository(pool as never, 'public')

    await expect(repository.getVariantTypeCounts(1)).resolves.toStrictEqual({ snv: 2, sv: 1 })
    expect(pool.query).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringMatching(/\bvariants\b/), values: [1] })
    )
  })

  it('returns distinct variant types for a case scope', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ variant_type: 'snv' }, { variant_type: 'str' }] })
    }
    const repository = new PostgresVariantReadRepository(pool as never, 'public')

    await expect(repository.getVariantTypesPresent({ caseId: 1 })).resolves.toStrictEqual([
      'snv',
      'str'
    ])
    expect(pool.query).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('case_id = $1'), values: [1] })
    )
  })

  it('returns gene symbols by prefix case-insensitively', async () => {
    const pool = { query: vi.fn().mockResolvedValueOnce({ rows: [{ gene_symbol: 'BRCA1' }] }) }
    const repository = new PostgresVariantReadRepository(pool as never, 'public')

    await expect(repository.getGeneSymbols(1, 'br', 20)).resolves.toStrictEqual(['BRCA1'])
    expect(pool.query).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('ILIKE'), values: [1, 'br%', 20] })
    )
  })

  it('searches the full search document instead of narrowing to gene_symbol', async () => {
    const pool = {
      query: vi.fn().mockResolvedValueOnce({
        rows: [
          {
            id: '1',
            case_id: '1',
            chr: '1',
            pos: '1000',
            ref: 'A',
            alt: 'G',
            gene_symbol: 'GENE1',
            consequence: 'stop_gained',
            internal_af: null
          }
        ]
      })
    }
    const repository = new PostgresVariantReadRepository(pool as never, 'public')

    await expect(repository.searchVariants(1, 'stop', 20)).resolves.toMatchObject([
      { id: 1, case_id: 1, consequence: 'stop_gained' }
    ])

    const spec = pool.query.mock.calls[0][0] as { text: string; values: unknown[] }
    expect(spec.text).toContain('search_document @@')
    expect(spec.text).toContain("to_tsquery('simple'")
    expect(spec.text).not.toContain('gene_symbol ILIKE')
    expect(spec.values).toEqual([1, 'stop:*', 20, 0])
  })

  it.each([
    ['tag_ids', { tag_ids: [1] }, 'variant_tags'],
    ['starred_only', { starred_only: true }, 'case_variant_annotations'],
    ['has_comment', { has_comment: true }, 'per_case_comment'],
    ['acmg_classifications', { acmg_classifications: ['Pathogenic'] }, 'acmg_classification'],
    [
      'annotation_scope all',
      { starred_only: true, annotation_scope: 'all' },
      'variant_annotations'
    ],
    ['active_panel_ids', { active_panel_ids: [1] }, 'case_active_panels'],
    ['inheritance_modes', { inheritance_modes: ['heterozygous'] }, 'gt_num'],
    [
      'analysis_group_id',
      { inheritance_modes: ['de_novo'], analysis_group_id: 7 },
      'analysis_group_members'
    ],
    ['consider_phasing', { consider_phasing: true }, 'variants']
  ])('supports postgres variant filter %s', async (_name, filter, expectedSql) => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
    }
    const repository = new PostgresVariantReadRepository(pool as never, 'public')

    await expect(
      repository.queryVariants({ case_id: 1, ...filter }, 25, 0, undefined, false, false)
    ).resolves.toMatchObject({ data: [] })
    expect(
      pool.query.mock.calls
        .map(([arg]) => (typeof arg === 'string' ? arg : ((arg as { text: string }).text ?? '')))
        .join('\n')
    ).toContain(expectedSql)
  })

  it('queries variants with supported filters, sorting, counts, and unfiltered count', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ count: '2' }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: '1',
              case_id: '1',
              chr: '1',
              pos: '1000',
              ref: 'A',
              alt: 'G',
              gene_symbol: 'BRCA1',
              variant_type: 'snv',
              internal_af: 0.5
            }
          ]
        })
        .mockResolvedValueOnce({ rows: [{ count: '5' }] })
    }
    const repository = new PostgresVariantReadRepository(pool as never, 'public')

    await expect(
      repository.queryVariants(
        {
          case_id: 1,
          variant_type: 'snv',
          gene_symbol: 'BRC',
          consequences: ['HIGH'],
          funcs: ['missense_variant'],
          clinvars: ['Pathogenic'],
          gnomad_af_max: 0.01,
          cadd_min: 20,
          max_internal_af: 0.6,
          search_query: 'BRCA1',
          column_filters: {
            consequence: { operator: 'in', value: ['HIGH'] },
            gene_symbol: { operator: 'like', value: 'BRC' }
          }
        },
        25,
        0,
        [{ key: 'pos', order: 'asc' }],
        false,
        true
      )
    ).resolves.toStrictEqual({
      data: [
        expect.objectContaining({
          id: 1,
          case_id: 1,
          pos: 1000,
          gene_symbol: 'BRCA1',
          variant_type: 'snv',
          internal_af: 0.5
        })
      ],
      total_count: 2,
      unfiltered_count: 5
    })

    const countSql = (pool.query.mock.calls[0][0] as { text: string }).text
    const dataSql = (pool.query.mock.calls[1][0] as { text: string }).text
    expect(countSql).toContain('COUNT(*)::int AS count')
    expect(dataSql).toContain('to_tsquery')
    expect(dataSql).toContain(
      'LEFT JOIN "public"."variant_frequency" vf ON vf.coord_hash = v.coord_hash'
    )
    expect(dataSql).not.toMatch(/vf\.chr\s*=\s*v\.chr/)
    expect(dataSql).not.toMatch(/vf\.ref\s*=\s*v\.ref/)
    expect(dataSql).not.toMatch(/vf\.alt\s*=\s*v\.alt/)
    expect(dataSql).toContain('COUNT(*) FROM "public"."cases"')
    expect(dataSql).toContain('EXISTS')
    expect(dataSql).toContain('"public"."variant_sv"')
    expect(dataSql).toContain('"public"."variant_str"')
    expect(dataSql).toContain('search_document @@')
    expect(dataSql).toContain('v.consequence IN')
    expect(dataSql).toContain('v.gene_symbol ILIKE')
    expect(dataSql).toContain("variant_type IN ('snv', 'indel')")
  })

  it('sanitizes postgres tsquery search tokens before appending prefix operators', async () => {
    expect(toPrefixTsQueryForTest('BRCA1')).toBe('BRCA1:*')
    expect(toPrefixTsQueryForTest('chr1:1000 A>G')).toBe('chr11000:* & AG:*')
    expect(toPrefixTsQueryForTest('***')).toBe('')
  })

  it('adds STR extension projections for str variant queries', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ count: '1' }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: '5',
              case_id: '1',
              chr: '4',
              pos: '4000',
              ref: 'CAG',
              alt: '<STR>',
              variant_type: 'str',
              _str_repeat_id: 'HTT'
            }
          ]
        })
    }
    const repository = new PostgresVariantReadRepository(pool as never, 'public')

    await repository.queryVariants(
      { case_id: 1, variant_type: 'str' },
      25,
      0,
      undefined,
      false,
      false
    )

    const strDataSql = (pool.query.mock.calls[1][0] as { text: string }).text
    expect(strDataSql).toContain('variant_str')
    expect(strDataSql).toContain('_str_repeat_id')
  })

  it('normalizes numeric extension projection aliases returned as strings', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ count: '1' }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: '3',
              case_id: '1',
              chr: '2',
              pos: '2000',
              ref: 'N',
              alt: '<DEL>',
              variant_type: 'sv',
              _sv_support: '12',
              _sv_dr: '8',
              _sv_dv: '4',
              _sv_is_precise: '1'
            }
          ]
        })
    }
    const repository = new PostgresVariantReadRepository(pool as never, 'public')

    await expect(
      repository.queryVariants({ case_id: 1, variant_type: 'sv' }, 25, 0, undefined, false, false)
    ).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          _sv_support: 12,
          _sv_dr: 8,
          _sv_dv: 4,
          _sv_is_precise: 1
        })
      ]
    })
  })

  it('supports extension column filters with the required extension join', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const repository = new PostgresVariantReadRepository(pool as never, 'public')

    await repository.queryVariants(
      { case_id: 1, column_filters: { 'sv.support': { operator: '>', value: 1 } } },
      25,
      0,
      undefined,
      false,
      false
    )

    const sql = (pool.query.mock.calls[0][0] as { text: string }).text
    expect(sql).toContain('"variant_sv" sv')
    expect(sql).toContain('sv.support >')
    expect(sql).not.toContain('sv.support IS NULL')
  })

  it('normalizes sort.order to a literal ASC/DESC even when it bypasses the SortItem enum (S7)', () => {
    // SortItem.order is typed 'asc' | 'desc', but that type only guards
    // callers going through the shared IPC contract. This SQL sink must not
    // rely solely on that upstream enum — it must normalize the value itself.
    const untypedOrder = 'asc; DROP TABLE cases; --' as unknown as 'asc' | 'desc'

    const { orderBySql } = buildPostgresVariantQueryParts({ case_id: 1 }, '"public"', [
      { key: 'pos', order: untypedOrder }
    ])

    expect(orderBySql).toMatch(/ORDER BY v\.pos (ASC|DESC) NULLS LAST/)
    expect(orderBySql).not.toContain('DROP TABLE')
  })

  it('rejects unsupported postgres column filter keys instead of ignoring them', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const repository = new PostgresVariantReadRepository(pool as never, 'public')

    await expect(
      repository.queryVariants(
        { case_id: 1, column_filters: { 'sv.does_not_exist': { operator: '>', value: 1 } } },
        25,
        0,
        undefined,
        false,
        false
      )
    ).rejects.toThrow('Unsupported PostgreSQL column filter(s): sv.does_not_exist')
    expect(pool.query).not.toHaveBeenCalled()
  })
})
