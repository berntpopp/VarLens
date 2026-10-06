import { describe, expect, it, vi } from 'vitest'

import { PostgresPanelIntervalResolver } from '../../../src/main/storage/postgres/postgres-panel-interval-resolver'
import {
  buildPostgresVariantQueryParts,
  PostgresVariantReadRepository
} from '../../../src/main/storage/postgres/PostgresVariantReadRepository'

function repoWithQueryCapture() {
  const calls: string[] = []
  const paramsByCall: unknown[][] = []
  // queryVariants now routes COUNT/data halves through runNamedDynamic, which calls
  // pool.query with a { name, text, values } spec object instead of positional
  // (text, values). Normalize both call shapes so capture stays shape-agnostic.
  const query = vi.fn(async (arg: unknown, params: unknown[] = []) => {
    const sql = typeof arg === 'string' ? arg : ((arg as { text?: string }).text ?? '')
    const values = typeof arg === 'string' ? params : ((arg as { values?: unknown[] }).values ?? [])
    calls.push(sql)
    paramsByCall.push(values)
    return { rows: sql.includes('SELECT COUNT(*)::int AS count') ? [{ count: 0 }] : [] }
  })
  return {
    repo: new PostgresVariantReadRepository({ query } as never, 'public'),
    calls,
    paramsByCall
  }
}

describe('PostgreSQL clinical variant filters', () => {
  it('supports precomputed panel interval filters', async () => {
    const { repo, calls, paramsByCall } = repoWithQueryCapture()

    await repo.queryVariants(
      {
        case_id: 1,
        panel_intervals: [
          { chr: '1', start: 100, end: 200 },
          { chr: '2', start: 300, end: 400 }
        ]
      },
      25
    )

    const sql = calls.join('\n')
    expect(sql).toContain('COALESCE(v.end_pos, v.pos)')
    expect(sql).toContain('v.pos <=')
    expect(sql).toContain('v.chr =')
    expect(paramsByCall[0]).toStrictEqual([1, '1', 100, 200, '2', 300, 400])
  })

  it('filters by case-scoped variant tags with a bigint array parameter', async () => {
    const { repo, calls, paramsByCall } = repoWithQueryCapture()
    await repo.queryVariants({ case_id: 1, tag_ids: [7, 8] }, 25)

    const sql = calls.join('\n')
    expect(sql).toContain('variant_tags')
    expect(sql).toMatch(/tag_id\s*=\s*ANY\(\$\d+::bigint\[\]\)/)
    expect(paramsByCall[0]).toContainEqual([7, 8])
  })

  it('filters by per-case comments in case annotation scope', async () => {
    const { repo, calls } = repoWithQueryCapture()
    await repo.queryVariants({ case_id: 1, has_comment: true }, 25)

    const sql = calls.join('\n')
    expect(sql).toContain('case_variant_annotations')
    expect(sql).toContain('per_case_comment')
    expect(sql).toContain("NULLIF(cva.per_case_comment, '') IS NOT NULL")
    expect(sql).not.toContain('FROM "public"."variant_annotations"')
  })

  it('filters by global comments when annotation scope includes all annotations', async () => {
    const { repo, calls } = repoWithQueryCapture()
    await repo.queryVariants({ case_id: 1, has_comment: true, annotation_scope: 'all' }, 25)

    const sql = calls.join('\n')
    expect(sql).toContain('case_variant_annotations')
    expect(sql).toContain('variant_annotations')
    expect(sql).toContain('global_comment')
    expect(sql).toContain("NULLIF(va.global_comment, '') IS NOT NULL")
    expect(sql).toContain('va.chr = v.chr')
    expect(sql).toContain('va.alt = v.alt')
  })

  it('filters by per-case ACMG classifications in case annotation scope', async () => {
    const { repo, calls, paramsByCall } = repoWithQueryCapture()
    await repo.queryVariants({ case_id: 1, acmg_classifications: ['Pathogenic'] }, 25)

    const sql = calls.join('\n')
    expect(sql).toContain('case_variant_annotations')
    expect(sql).toContain('acmg_classification')
    expect(sql).toMatch(/cva\.acmg_classification\s*=\s*ANY\(\$\d+::text\[\]\)/)
    expect(sql).not.toContain('FROM "public"."variant_annotations"')
    expect(paramsByCall[0]).toContainEqual(['Pathogenic'])
  })

  it('filters by global ACMG classifications when annotation scope includes all annotations', async () => {
    const { repo, calls, paramsByCall } = repoWithQueryCapture()
    await repo.queryVariants(
      {
        case_id: 1,
        acmg_classifications: ['Pathogenic', 'Likely pathogenic'],
        annotation_scope: 'all'
      },
      25
    )

    const sql = calls.join('\n')
    expect(sql).toContain('case_variant_annotations')
    expect(sql).toContain('variant_annotations')
    expect(sql).toMatch(/cva\.acmg_classification\s*=\s*ANY\(\$\d+::text\[\]\)/)
    expect(sql).toMatch(/va\.acmg_classification\s*=\s*ANY\(\$\d+::text\[\]\)/)
    expect(paramsByCall[0]).toContainEqual(['Pathogenic', 'Likely pathogenic'])
  })

  it('checks case and global starred annotations when annotation scope includes all annotations', async () => {
    const { repo, calls } = repoWithQueryCapture()
    await repo.queryVariants({ case_id: 1, starred_only: true, annotation_scope: 'all' }, 25)

    const sql = calls.join('\n')
    expect(sql).toContain('case_variant_annotations')
    expect(sql).toContain('variant_annotations')
    expect(sql).toContain('cva.starred')
    expect(sql).toContain('va.starred')
  })

  it('resolves active panels to padded genomic regions for the build of the case (issue #447)', async () => {
    const calls: string[] = []
    const query = vi.fn(async (arg: unknown) => {
      const sql = typeof arg === 'string' ? arg : ((arg as { text?: string }).text ?? '')
      calls.push(sql)
      if (sql.includes('AS genome_build'))
        return { rows: [{ genome_build: 'GRCh37', chr: 'chr7' }] }
      return { rows: sql.includes('SELECT COUNT(*)::int AS count') ? [{ count: 0 }] : [] }
    })
    const lookup = vi.fn().mockResolvedValue([{ chr: 'chr7', start: 95_000, end: 205_000 }])
    const repo = new PostgresVariantReadRepository(
      { query } as never,
      'public',
      new PostgresPanelIntervalResolver({ query } as never, 'public', lookup)
    )

    await repo.queryVariants({ case_id: 1, active_panel_ids: [3, 4], panel_padding_bp: 2500 }, 25)

    expect(lookup).toHaveBeenCalledWith([3, 4], 'GRCh37', 2500, true)
    const filterSql = calls.filter((sql) => sql.includes('FROM "public"."variants" v')).join('\n')
    expect(filterSql).toContain('(v.chr = $2 AND v.pos <= $4 AND COALESCE(v.end_pos, v.pos) >= $3)')
    // The gene-symbol fallback is gone: it ignored padding and genome build.
    expect(filterSql).not.toContain('case_active_panels')
    expect(filterSql).not.toContain('gene_symbol')
  })

  it('fails the query when panel regions cannot be resolved, never widening or narrowing it', async () => {
    const query = vi.fn(async () => ({ rows: [{ genome_build: 'GRCh38', chr: '7' }] }))
    const lookup = vi.fn().mockRejectedValue(new Error('gene reference unavailable'))
    const repo = new PostgresVariantReadRepository(
      { query } as never,
      'public',
      new PostgresPanelIntervalResolver({ query } as never, 'public', lookup)
    )

    await expect(repo.queryVariants({ case_id: 1, active_panel_ids: [3] }, 25)).rejects.toThrow(
      'gene reference unavailable'
    )
    // Only the case-context read ran; no variant query was issued.
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('refuses to build SQL for a panel request that was never resolved', () => {
    expect(() =>
      buildPostgresVariantQueryParts({ case_id: 1, active_panel_ids: [3] }, '"public"')
    ).toThrow(/not resolved to genomic intervals/)
  })

  it('uses precomputed panel intervals instead of active panel lookup when intervals are present', async () => {
    const { repo, calls } = repoWithQueryCapture()
    await repo.queryVariants(
      {
        case_id: 1,
        active_panel_ids: [3],
        panel_intervals: [{ chr: '1', start: 100, end: 200 }]
      },
      25
    )

    const sql = calls.join('\n')
    expect(sql).toContain('COALESCE(v.end_pos, v.pos)')
    expect(sql).not.toContain('case_active_panels')
    expect(sql).not.toContain('panel_genes')
  })

  it.each([
    ['homozygous', "'1/1'", "'1|1'"],
    ['heterozygous', "'0/1'", "'0|1'"],
    ['x_hemizygous', "'X'", "'chrX'"]
  ])('adds gt_num predicates for %s inheritance filters', async (mode, expectedA, expectedB) => {
    const { repo, calls } = repoWithQueryCapture()
    await repo.queryVariants({ case_id: 1, inheritance_modes: [mode] }, 25)

    const sql = calls.join('\n')
    expect(sql).toContain('gt_num')
    expect(sql).toContain(expectedA)
    expect(sql).toContain(expectedB)
  })

  it('adds analysis group member coordinate joins for de novo inheritance filters', async () => {
    const { repo, calls, paramsByCall } = repoWithQueryCapture()
    await repo.queryVariants(
      { case_id: 1, inheritance_modes: ['de_novo'], analysis_group_id: 9 },
      25
    )

    const sql = calls.join('\n')
    expect(sql).toContain('analysis_group_members')
    expect(sql).toContain('agm_f.role =')
    expect(sql).toContain('agm_m.role =')
    expect(sql).toContain('f.chr = p.chr')
    expect(sql).toContain('m.alt = p.alt')
    expect(paramsByCall[0]).toContain(9)
  })

  it('accepts consider_phasing as an inheritance no-op', async () => {
    const { repo, calls } = repoWithQueryCapture()

    await expect(repo.queryVariants({ case_id: 1, consider_phasing: true }, 25)).resolves.toEqual({
      data: [],
      total_count: 0
    })

    const sql = calls.join('\n')
    expect(sql).toContain('"variants" v')
    expect(sql.toLowerCase()).not.toContain('phas')
  })
})
