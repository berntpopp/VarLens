import { describe, expect, it } from 'vitest'

import {
  COHORT_SUMMARY_FILTER_COLUMNS,
  normalizeCohortColumnFilters,
  UnsupportedCohortColumnFilterError
} from '../../../src/shared/filters/cohort-column-filter-keys'
import {
  FILTER_COLUMNS,
  getColumnSuggestions,
  isColumnInScope
} from '../../../src/renderer/src/dsl/column-registry'

describe('normalizeCohortColumnFilters (#528)', () => {
  it('maps the DSL CADD key to the cohort column and keeps canonical keys', () => {
    expect(
      normalizeCohortColumnFilters({
        cadd: { operator: '>=', value: 20 },
        cdna: { operator: 'like', value: 'c.1' },
        aa_change: { operator: '=', value: 'p.M1fs' },
        'cnv.copy_number': { operator: '>', value: 2 }
      })
    ).toEqual({
      cadd_phred: { operator: '>=', value: 20 },
      cdna: { operator: 'like', value: 'c.1' },
      aa_change: { operator: '=', value: 'p.M1fs' },
      'cnv.copy_number': { operator: '>', value: 2 }
    })
  })

  it('rejects case-only and unknown keys instead of dropping them', () => {
    expect(() =>
      normalizeCohortColumnFilters({
        gene_symbol: { operator: '=', value: 'BRCA1' },
        qual: { operator: '>', value: 30 },
        gt_num: { operator: '=', value: '1/1' },
        'cnv.nope': { operator: '>', value: 1 },
        constructor: { operator: '=', value: 'x' }
      })
    ).toThrow(new UnsupportedCohortColumnFilterError(['qual', 'gt_num', 'cnv.nope', 'constructor']))
  })

  it('rejects a CADD filter given under both spellings', () => {
    expect(() =>
      normalizeCohortColumnFilters({
        cadd: { operator: '>=', value: 20 },
        cadd_phred: { operator: '<', value: 30 }
      })
    ).toThrow('Conflicting cohort column filters for "cadd_phred"')
  })

  it('accepts every DSL column the registry offers in the cohort scope', () => {
    const cohortKeys = FILTER_COLUMNS.filter((col) => isColumnInScope(col, 'cohort'))
    for (const col of cohortKeys) {
      expect(() =>
        normalizeCohortColumnFilters({ [col.key]: { operator: '=', value: '1' } })
      ).not.toThrow()
    }
    // Shortlist-rule registrations of stored SV columns (sv_type, sv_length; #581)
    // leave the cohort's own filter on those columns untouched.
    const ruleOnlyStored = (c: (typeof FILTER_COLUMNS)[number]): boolean =>
      c.shortlistOnly === true && c.key in COHORT_SUMMARY_FILTER_COLUMNS
    for (const col of FILTER_COLUMNS.filter(
      (c) => !isColumnInScope(c, 'cohort') && !ruleOnlyStored(c)
    )) {
      expect(() =>
        normalizeCohortColumnFilters({ [col.key]: { operator: '=', value: '1' } })
      ).toThrow(UnsupportedCohortColumnFilterError)
    }
  })

  it('omits case-only columns from cohort autocomplete', () => {
    const cohort = getColumnSuggestions('', 'cohort').map((col) => col.key)
    expect(cohort).toContain('cadd')
    expect(cohort).not.toContain('qual')
    expect(cohort).not.toContain('gt_num')
    expect(getColumnSuggestions('q').map((col) => col.key)).toContain('qual')
  })
})
