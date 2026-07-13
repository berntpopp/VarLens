import { describe, it, expect } from 'vitest'
import { buildBaseWhere } from '../../../src/main/database/variant-where-builder'
import type { ColumnFilter } from '../../../src/shared/types/column-filters'

describe('buildBaseWhere', () => {
  it('returns empty sql + params for empty filters', () => {
    const result = buildBaseWhere({}, { baseAlias: 'v', scope: 'case' })
    expect(result.sql).toBe('')
    expect(result.params).toEqual([])
  })

  it('translates gnomad_af_max with IS NULL OR branch', () => {
    const result = buildBaseWhere({ gnomad_af_max: 0.01 }, { baseAlias: 'v', scope: 'case' })
    expect(result.sql).toContain('v.gnomad_af')
    expect(result.sql).toContain('IS NULL OR')
    expect(result.params).toEqual([0.01])
  })

  it('translates consequences to IN clause', () => {
    const result = buildBaseWhere(
      { consequences: ['missense_variant', 'stop_gained'] },
      { baseAlias: 'v', scope: 'case' }
    )
    expect(result.sql).toContain('v.consequence IN (?, ?)')
    expect(result.params).toEqual(['missense_variant', 'stop_gained'])
  })

  it('adds gene_symbol IS NOT NULL for cohort-burden scope', () => {
    const result = buildBaseWhere({}, { baseAlias: 'v', scope: 'cohort-burden' })
    expect(result.sql).toContain('gene_symbol IS NOT NULL')
    expect(result.sql).toContain("gene_symbol != ''")
  })

  it('SNV/indel collapse in cohort-listing scope for variant_type=snv', () => {
    const result = buildBaseWhere(
      { variant_type: 'snv' },
      { baseAlias: 'cvs', scope: 'cohort-listing' }
    )
    expect(result.sql).toContain("cvs.variant_type IN ('snv', 'indel')")
  })

  it('exact variant_type match for non-snv in cohort-listing', () => {
    const result = buildBaseWhere(
      { variant_type: 'sv' },
      { baseAlias: 'cvs', scope: 'cohort-listing' }
    )
    expect(result.sql).toContain('cvs.variant_type = ?')
    expect(result.params).toEqual(['sv'])
  })

  it('bare column_filter with range operator', () => {
    const filter: ColumnFilter = { operator: '<=', value: 0.05, includeEmpty: true }
    const result = buildBaseWhere(
      { column_filters: { gnomad_af: filter } },
      { baseAlias: 'v', scope: 'case' }
    )
    expect(result.sql).toContain('v.gnomad_af')
    expect(result.sql).toContain('IS NULL OR')
    expect(result.params).toEqual([0.05])
  })

  it('bare column_filter with includeEmpty=false skips IS NULL OR', () => {
    const filter: ColumnFilter = { operator: '>=', value: 20, includeEmpty: false }
    const result = buildBaseWhere(
      { column_filters: { cadd: filter } },
      { baseAlias: 'v', scope: 'case' }
    )
    expect(result.sql).not.toContain('IS NULL OR')
    expect(result.params).toEqual([20])
  })

  it('skips dotted (extension) column_filter keys — handled per-path', () => {
    const filter: ColumnFilter = { operator: '>=', value: 3 }
    const result = buildBaseWhere(
      { column_filters: { 'cnv.copy_number': filter, gnomad_af: { operator: '<=', value: 0.01 } } },
      { baseAlias: 'v', scope: 'case' }
    )
    expect(result.sql).not.toContain('cnv.copy_number')
    expect(result.sql).toContain('v.gnomad_af')
    expect(result.params).toEqual([0.01])
  })

  it('combines multiple conditions with AND', () => {
    const result = buildBaseWhere(
      { gnomad_af_max: 0.01, cadd_min: 20, consequences: ['missense_variant'] },
      { baseAlias: 'v', scope: 'case' }
    )
    // All three conditions present
    expect(result.sql).toContain('v.gnomad_af')
    expect(result.sql).toContain('v.cadd')
    expect(result.sql).toContain('v.consequence IN')
    expect(result.params).toEqual([0.01, 20, 'missense_variant'])
  })
})

describe('translateColumnFilter branches', () => {
  it('column_filter operator=in produces IN clause', () => {
    const result = buildBaseWhere(
      { column_filters: { gene_symbol: { operator: 'in', value: ['BRCA1', 'BRCA2'] } } },
      { baseAlias: 'v', scope: 'case' }
    )
    expect(result.sql).toContain('v.gene_symbol IN (?, ?)')
    expect(result.params).toEqual(['BRCA1', 'BRCA2'])
  })

  it('column_filter operator=in with empty array is dropped', () => {
    const result = buildBaseWhere(
      { column_filters: { gene_symbol: { operator: 'in', value: [] } } },
      { baseAlias: 'v', scope: 'case' }
    )
    expect(result.sql).toBe('')
    expect(result.params).toEqual([])
  })

  it('column_filter operator=like produces LIKE with NOCASE', () => {
    const result = buildBaseWhere(
      { column_filters: { gene_symbol: { operator: 'like', value: 'brca' } } },
      { baseAlias: 'v', scope: 'case' }
    )
    expect(result.sql).toContain('v.gene_symbol LIKE ? COLLATE NOCASE')
    expect(result.params).toEqual(['%brca%'])
  })

  it('column_filter operator=like with whitespace is dropped', () => {
    const result = buildBaseWhere(
      { column_filters: { gene_symbol: { operator: 'like', value: '  ' } } },
      { baseAlias: 'v', scope: 'case' }
    )
    expect(result.sql).toBe('')
    expect(result.params).toEqual([])
  })

  it('column_filter operator= produces equality clause', () => {
    const result = buildBaseWhere(
      { column_filters: { variant_type: { operator: '=', value: 'snv' } } },
      { baseAlias: 'v', scope: 'case' }
    )
    expect(result.sql).toContain('v.variant_type = ?')
    expect(result.params).toEqual(['snv'])
  })

  it('column_filter operator!= produces not-equal clause', () => {
    const result = buildBaseWhere(
      { column_filters: { variant_type: { operator: '!=', value: 'sv' } } },
      { baseAlias: 'v', scope: 'case' }
    )
    expect(result.sql).toContain('v.variant_type != ?')
    expect(result.params).toEqual(['sv'])
  })

  it('rejects non-identifier column_filter keys (SQL identifier safety)', () => {
    const result = buildBaseWhere(
      { column_filters: { 'x; DROP TABLE cases; --': { operator: '=', value: 1 } } },
      { baseAlias: 'v', scope: 'case' }
    )
    expect(result.sql).toBe('')
    expect(result.params).toEqual([])
  })
})

describe('cohort-summary-only field gating', () => {
  // These fields reference columns that only exist on cohort_variant_summary
  // (cohort_frequency, carrier_count, has_star, has_comment, acmg_best) and
  // must be silently dropped for case + cohort-burden scopes that query the
  // raw variants table.

  it('drops max_internal_af for case scope', () => {
    const result = buildBaseWhere({ max_internal_af: 0.05 }, { baseAlias: 'v', scope: 'case' })
    expect(result.sql).not.toContain('cohort_frequency')
    expect(result.sql).toBe('')
    expect(result.params).toEqual([])
  })

  it('drops max_internal_af for cohort-burden scope', () => {
    const result = buildBaseWhere(
      { max_internal_af: 0.05 },
      { baseAlias: 'v', scope: 'cohort-burden' }
    )
    expect(result.sql).not.toContain('cohort_frequency')
    // cohort-burden adds gene_symbol invariants, so params should only reflect those
    expect(result.params).toEqual([])
  })

  it('keeps max_internal_af for cohort-listing scope', () => {
    const result = buildBaseWhere(
      { max_internal_af: 0.05 },
      { baseAlias: 'cvs', scope: 'cohort-listing' }
    )
    expect(result.sql).toContain('cvs.cohort_frequency')
    expect(result.params).toEqual([0.05])
  })

  it('drops carrier_count_min for case + cohort-burden scopes', () => {
    const caseResult = buildBaseWhere({ carrier_count_min: 3 }, { baseAlias: 'v', scope: 'case' })
    expect(caseResult.sql).not.toContain('carrier_count')

    const burdenResult = buildBaseWhere(
      { carrier_count_min: 3 },
      { baseAlias: 'v', scope: 'cohort-burden' }
    )
    expect(burdenResult.sql).not.toContain('carrier_count')
  })

  it('keeps carrier_count_min for cohort-listing scope', () => {
    const result = buildBaseWhere(
      { carrier_count_min: 3 },
      { baseAlias: 'cvs', scope: 'cohort-listing' }
    )
    expect(result.sql).toContain('cvs.carrier_count >= ?')
    expect(result.params).toEqual([3])
  })

  it('drops acmg_classifications for case + cohort-burden scopes', () => {
    const caseResult = buildBaseWhere(
      { acmg_classifications: ['Pathogenic'] },
      { baseAlias: 'v', scope: 'case' }
    )
    expect(caseResult.sql).not.toContain('acmg_best')

    const burdenResult = buildBaseWhere(
      { acmg_classifications: ['Pathogenic'] },
      { baseAlias: 'v', scope: 'cohort-burden' }
    )
    expect(burdenResult.sql).not.toContain('acmg_best')
  })

  it('keeps acmg_classifications for cohort-listing scope', () => {
    const result = buildBaseWhere(
      { acmg_classifications: ['Pathogenic', 'Likely pathogenic'] },
      { baseAlias: 'cvs', scope: 'cohort-listing' }
    )
    expect(result.sql).toContain('cvs.acmg_best IN (?, ?)')
    expect(result.params).toEqual(['Pathogenic', 'Likely pathogenic'])
  })

  it('drops starred_only + has_comment for case + cohort-burden scopes', () => {
    const caseResult = buildBaseWhere(
      { starred_only: true, has_comment: true },
      { baseAlias: 'v', scope: 'case' }
    )
    expect(caseResult.sql).not.toContain('has_star')
    expect(caseResult.sql).not.toContain('has_comment')

    const burdenResult = buildBaseWhere(
      { starred_only: true, has_comment: true },
      { baseAlias: 'v', scope: 'cohort-burden' }
    )
    expect(burdenResult.sql).not.toContain('has_star')
    expect(burdenResult.sql).not.toContain('has_comment')
  })

  it('keeps starred_only + has_comment for cohort-listing scope', () => {
    const result = buildBaseWhere(
      { starred_only: true, has_comment: true },
      { baseAlias: 'cvs', scope: 'cohort-listing' }
    )
    expect(result.sql).toContain('cvs.has_star = 1')
    expect(result.sql).toContain('cvs.has_comment = 1')
  })

  it('cohort-burden with only cohort-summary-only fields still emits invariants', () => {
    // Even when all filter fields are dropped, cohort-burden scope still
    // emits gene_symbol IS NOT NULL + gene_symbol != '' invariants.
    const result = buildBaseWhere(
      {
        max_internal_af: 0.05,
        carrier_count_min: 3,
        acmg_classifications: ['Pathogenic'],
        starred_only: true,
        has_comment: true
      },
      { baseAlias: 'v', scope: 'cohort-burden' }
    )
    expect(result.sql).toContain('v.gene_symbol IS NOT NULL')
    expect(result.sql).toContain("v.gene_symbol != ''")
    expect(result.sql).not.toContain('cohort_frequency')
    expect(result.sql).not.toContain('carrier_count')
    expect(result.sql).not.toContain('acmg_best')
    expect(result.sql).not.toContain('has_star')
    expect(result.sql).not.toContain('has_comment')
    expect(result.params).toEqual([])
  })
})

describe('bare column_filters key allowlist for variants-table scopes (S7 info fix)', () => {
  // `case` (shortlist) and `cohort-burden` (association) scopes query the
  // `variants` table directly and pass column_filters straight into
  // buildBaseWhere without any pre-remap step (unlike cohort.ts, which
  // remaps + validates keys against its own SORTABLE_COLUMNS before ever
  // calling buildBaseWhere). IDENTIFIER_RE alone only blocks SQL
  // metacharacters — it does not stop a syntactically valid but unintended
  // column name from being referenced. Bare keys for these two scopes must
  // additionally be gated through the same allowlist VariantFilterBuilder
  // uses for its own column_filters path (BASE_SORTABLE_COLUMNS).

  it('rejects an unknown-but-identifier-safe bare column key for cohort-burden scope', () => {
    const result = buildBaseWhere(
      { column_filters: { not_a_real_column: { operator: '=', value: 1 } } },
      { baseAlias: 'v', scope: 'cohort-burden' }
    )
    expect(result.sql).not.toContain('not_a_real_column')
    // cohort-burden always emits its gene_symbol invariants regardless of
    // column_filters — assert only that the unknown filter contributed
    // nothing beyond those.
    expect(result.sql).toBe(`v.gene_symbol IS NOT NULL AND v.gene_symbol != ''`)
    expect(result.params).toEqual([])
  })

  it('rejects an unknown-but-identifier-safe bare column key for case scope', () => {
    const result = buildBaseWhere(
      { column_filters: { not_a_real_column: { operator: '=', value: 1 } } },
      { baseAlias: 'v', scope: 'case' }
    )
    expect(result.sql).not.toContain('not_a_real_column')
    expect(result.sql).toBe('')
    expect(result.params).toEqual([])
  })

  it('still accepts a known bare column key for cohort-burden scope', () => {
    const result = buildBaseWhere(
      { column_filters: { gnomad_af: { operator: '<=', value: 0.01 } } },
      { baseAlias: 'v', scope: 'cohort-burden' }
    )
    expect(result.sql).toContain('v.gnomad_af <= ?')
    expect(result.params).toEqual([0.01])
  })

  it('still accepts a known bare column key for case scope', () => {
    const result = buildBaseWhere(
      { column_filters: { cadd: { operator: '>=', value: 20, includeEmpty: false } } },
      { baseAlias: 'v', scope: 'case' }
    )
    expect(result.sql).toContain('v.cadd >= ?')
    expect(result.params).toEqual([20])
  })

  it('does not restrict cohort-listing scope bare keys via the variants-table allowlist', () => {
    // cohort.ts already remaps + validates column_filters keys against its
    // own SORTABLE_COLUMNS (cohort_variant_summary columns, including
    // cohort-only fields absent from the variants table) before calling
    // buildBaseWhere. Re-gating here with the variants-table allowlist would
    // incorrectly reject legitimate cohort-only fields like carrier_count —
    // a cohort-parity regression.
    const result = buildBaseWhere(
      { column_filters: { carrier_count: { operator: '>=', value: 2 } } },
      { baseAlias: 'cvs', scope: 'cohort-listing' }
    )
    expect(result.sql).toContain('cvs.carrier_count >= ?')
    expect(result.params).toEqual([2])
  })
})
