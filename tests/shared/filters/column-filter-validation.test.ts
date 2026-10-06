import { describe, expect, it } from 'vitest'

import {
  assertValidColumnFilterValues,
  ColumnFilterValueError,
  NUMERIC_COLUMN_FILTER_KEYS
} from '../../../src/shared/filters/column-filter-validation'
import {
  buildNullCheckSql,
  isNullCheckOperator
} from '../../../src/shared/filters/column-null-check'

describe('null-check column filters', () => {
  it('are recognised by operator and need no numeric value', () => {
    expect(isNullCheckOperator('is_null')).toBe(true)
    expect(isNullCheckOperator('not_null')).toBe(true)
    expect(isNullCheckOperator('=')).toBe(false)
    expect(() =>
      assertValidColumnFilterValues({
        cadd: { operator: 'is_null', value: '' },
        pos: { operator: 'not_null', value: 'ignored' }
      })
    ).not.toThrow()
  })

  it('test NULL only on numeric columns and NULL-or-empty on text columns', () => {
    expect(buildNullCheckSql('v.cadd', 'is_null', true, 'sqlite')).toBe('v.cadd IS NULL')
    expect(buildNullCheckSql('v.cadd', 'not_null', true, 'postgres')).toBe('v.cadd IS NOT NULL')
    expect(buildNullCheckSql('v.gene', 'is_null', false, 'sqlite')).toBe(
      "(v.gene IS NULL OR v.gene = '')"
    )
    expect(buildNullCheckSql('v.gene', 'not_null', false, 'sqlite')).toBe(
      "(v.gene IS NOT NULL AND v.gene <> '')"
    )
    // PostgreSQL cannot compare a non-text column (integer flag) with ''.
    expect(buildNullCheckSql('sv.flag', 'is_null', false, 'postgres')).toBe(
      "(sv.flag IS NULL OR sv.flag::text = '')"
    )
  })
})

describe('assertValidColumnFilterValues', () => {
  it('rejects a blank string on a numeric column instead of reading it as zero', () => {
    for (const value of ['', '  ']) {
      expect(() => assertValidColumnFilterValues({ cadd: { operator: '=', value } })).toThrow(
        ColumnFilterValueError
      )
    }
    // Text columns may still be compared with the empty string.
    expect(() =>
      assertValidColumnFilterValues({ gene_symbol: { operator: '=', value: '' } })
    ).not.toThrow()
  })

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

  it('covers case-view, cohort-view and extension numeric keys', () => {
    for (const key of ['cadd', 'cadd_phred', 'cohort_frequency', 'cnv.copy_number']) {
      expect(NUMERIC_COLUMN_FILTER_KEYS.has(key), key).toBe(true)
    }
  })
})
