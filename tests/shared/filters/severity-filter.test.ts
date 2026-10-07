/**
 * The SQL of a filter on impact or ClinVar: by normalised category (#469).
 */
import { describe, expect, it } from 'vitest'

import {
  severityFilterOperands,
  severityFilterSql
} from '../../../src/shared/filters/severity-filter'

function target(): { column: string; rank: string; bind: (v: string) => string; bound: string[] } {
  const bound: string[] = []
  return {
    column: 'v.clinvar',
    rank: 'v.clinvar_rank',
    bound,
    bind: (value) => {
      bound.push(value)
      return `$${bound.length}`
    }
  }
}

describe('severityFilterSql', () => {
  it('matches the categories of the values by rank, and the values themselves by text', () => {
    const t = target()
    expect(severityFilterSql('clinvar', ['Pathogenic', 'Likely_pathogenic'], t)).toBe(
      '(v.clinvar_rank IN (15, 14, 13) OR v.clinvar IN ($1, $2))'
    )
    expect(t.bound).toEqual(['Pathogenic', 'Likely_pathogenic'])
  })

  it('matches a value that is no known category by its text only, bound as a parameter', () => {
    const t = target()
    expect(severityFilterSql('clinvar', ["odd'; DROP"], t)).toBe('v.clinvar IN ($1)')
    expect(t.bound).toEqual(["odd'; DROP"])
  })

  it('negates without selecting rows that have no value', () => {
    expect(severityFilterSql('clinvar', ['Benign'], target(), true)).toBe(
      '(v.clinvar IS NOT NULL AND NOT (v.clinvar_rank IN (3, 2) OR v.clinvar IN ($1)))'
    )
  })

  it('is null for other columns and for no values', () => {
    expect(severityFilterSql('func', ['x'], target())).toBeNull()
    expect(severityFilterSql('clinvar', [], target())).toBeNull()
  })
})

describe('severityFilterOperands', () => {
  it('covers in, = and !=', () => {
    expect(severityFilterOperands('in', ['a', 'b'])).toEqual({ values: ['a', 'b'], negate: false })
    expect(severityFilterOperands('=', 'a')).toEqual({ values: ['a'], negate: false })
    expect(severityFilterOperands('!=', 'a')).toEqual({ values: ['a'], negate: true })
    expect(severityFilterOperands('like', 'a')).toBeNull()
    expect(severityFilterOperands('in', 'a')).toBeNull()
  })
})
