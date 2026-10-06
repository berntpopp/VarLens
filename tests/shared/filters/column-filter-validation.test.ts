import { describe, expect, it } from 'vitest'

import {
  assertValidColumnFilterValues,
  ColumnFilterValueError,
  NUMERIC_COLUMN_FILTER_KEYS
} from '../../../src/shared/filters/column-filter-validation'

describe('assertValidColumnFilterValues', () => {
  it('accepts absent filters and finite numeric values, including numeric strings', () => {
    expect(() => assertValidColumnFilterValues(undefined)).not.toThrow()
    expect(() =>
      assertValidColumnFilterValues({
        cadd: { operator: '>=', value: 20 },
        gnomad_af: { operator: '<', value: '0.01' },
        pos: { operator: 'in', value: ['100', '200'] },
        'cnv.copy_number': { operator: '=', value: '3' }
      })
    ).not.toThrow()
  })

  it.each(['=', '!=', '<', '>', '<=', '>='] as const)(
    'rejects a non-numeric value for %s on a numeric column',
    (operator) => {
      expect(() => assertValidColumnFilterValues({ cadd: { operator, value: 'abc' } })).toThrow(
        ColumnFilterValueError
      )
    }
  )

  it('names the column and the offending value', () => {
    expect(() =>
      assertValidColumnFilterValues({ cadd_phred: { operator: '<', value: 'abc' } })
    ).toThrow('Invalid numeric value for column filter "cadd_phred": "abc" is not a number')
  })

  it('rejects non-finite numbers and any non-numeric member of an `in` list', () => {
    expect(() =>
      assertValidColumnFilterValues({ cadd: { operator: '<', value: Number.NaN } })
    ).toThrow(ColumnFilterValueError)
    expect(() =>
      assertValidColumnFilterValues({ cadd: { operator: '<', value: 'Infinity' } })
    ).toThrow(ColumnFilterValueError)
    expect(() =>
      assertValidColumnFilterValues({ 'sv.support': { operator: 'in', value: ['3', 'many'] } })
    ).toThrow('"many" is not a number')
  })

  it('leaves text columns, unknown keys and textual `like` filters alone', () => {
    expect(() =>
      assertValidColumnFilterValues({
        gene_symbol: { operator: '=', value: 'abc' },
        not_a_column: { operator: '<', value: 'abc' },
        cadd: { operator: 'like', value: 'abc' }
      })
    ).not.toThrow()
  })

  it('keeps the empty-string comparison both backends coerce to 0 (DSL is:null)', () => {
    // dsl/translator.ts emits `{ operator: '=', value: '' }` for `is:null`.
    // Both backends bind it as 0 today; rejecting it here would turn an
    // existing (if imprecise) query into an error.
    expect(() =>
      assertValidColumnFilterValues({ cadd: { operator: '=', value: '' } })
    ).not.toThrow()
  })

  it('covers case-view, cohort-view and extension numeric keys', () => {
    for (const key of ['cadd', 'cadd_phred', 'cohort_frequency', 'cnv.copy_number']) {
      expect(NUMERIC_COLUMN_FILTER_KEYS.has(key), key).toBe(true)
    }
  })
})
