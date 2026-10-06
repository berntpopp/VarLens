import { describe, it, expect } from 'vitest'
import { compareScoredRows } from '../../../../src/main/services/scoring'
import { buildShortlistCandidate } from '../../../fixtures/shortlist/cross-type-variant-fixture'
import type { ScoredCandidate } from '../../../../src/shared/types/shortlist'

function scored(
  id: number,
  rank_score: number,
  overrides: Partial<ScoredCandidate> = {}
): ScoredCandidate {
  return {
    ...buildShortlistCandidate({ id, variant_type: 'snv' }),
    rank_score,
    rank_components: { impact: 0, pathogenicity: 0, rarity: 0, clinvar: 0, phenotype: 0 },
    rank_clinvar_pinned: false,
    rank_starred_pinned: false,
    ...overrides
  }
}

describe('compareScoredRows()', () => {
  it('sorts by rank_score descending', () => {
    const a = scored(1, 0.5)
    const b = scored(2, 0.9)
    expect(compareScoredRows(a, b)).toBeGreaterThan(0) // b before a
  })

  it('starred pin overrides everything', () => {
    const starred = scored(1, 0.1, { rank_starred_pinned: true })
    const top = scored(2, 0.95, { rank_clinvar_pinned: true })
    expect(compareScoredRows(starred, top)).toBeLessThan(0)
  })

  it('clinvar pin beats unpinned even at lower rank_score', () => {
    const pinned = scored(1, 0.4, { rank_clinvar_pinned: true })
    const unpinned = scored(2, 0.95)
    expect(compareScoredRows(pinned, unpinned)).toBeLessThan(0)
  })

  it('chr tie-breaker uses natural chromosome order (1..22, X, Y, MT)', () => {
    const rows = ['10', 'MT', '2', 'X', '1', 'GL000220.1', '22', 'Y'].map((chr, i) =>
      scored(i + 1, 0.5, { chr } as Partial<ScoredCandidate>)
    )
    const sorted = [...rows].sort((a, b) =>
      compareScoredRows(a, b, [
        { key: 'chr', order: 'asc' },
        { key: 'pos', order: 'asc' }
      ])
    )
    expect(sorted.map((r) => r.chr)).toEqual(['1', '2', '10', '22', 'X', 'Y', 'MT', 'GL000220.1'])
  })

  it('tie-breakers apply after rank_score ties', () => {
    const a = scored(1, 0.5, { cadd: 10 } as Partial<ScoredCandidate>)
    const b = scored(2, 0.5, { cadd: 30 } as Partial<ScoredCandidate>)
    expect(compareScoredRows(a, b, [{ key: 'cadd', order: 'desc' }])).toBeGreaterThan(0)
  })

  it('tie-breakers respect asc order', () => {
    const a = scored(1, 0.5, { cadd: 10 } as Partial<ScoredCandidate>)
    const b = scored(2, 0.5, { cadd: 30 } as Partial<ScoredCandidate>)
    expect(compareScoredRows(a, b, [{ key: 'cadd', order: 'asc' }])).toBeLessThan(0)
  })

  it('stable fallback on id when everything else ties', () => {
    const a = scored(10, 0.5)
    const b = scored(20, 0.5)
    expect(compareScoredRows(a, b)).toBeLessThan(0)
  })

  it('both starred: falls through to rank_score', () => {
    const a = scored(1, 0.8, { rank_starred_pinned: true })
    const b = scored(2, 0.4, { rank_starred_pinned: true })
    expect(compareScoredRows(a, b)).toBeLessThan(0)
  })

  it('both clinvar-pinned: falls through to rank_score', () => {
    const a = scored(1, 0.3, { rank_clinvar_pinned: true })
    const b = scored(2, 0.7, { rank_clinvar_pinned: true })
    expect(compareScoredRows(a, b)).toBeGreaterThan(0)
  })

  it('string tie-breaker uses localeCompare', () => {
    const a = scored(1, 0.5, { gene_symbol: 'BRCA2' } as Partial<ScoredCandidate>)
    const b = scored(2, 0.5, { gene_symbol: 'BRCA1' } as Partial<ScoredCandidate>)
    expect(compareScoredRows(a, b, [{ key: 'gene_symbol', order: 'asc' }])).toBeGreaterThan(0)
  })

  it('null tie-breaker values sort to end under ascending order', () => {
    // compareByKey returns +1 when `a` is null, so under ASC order null rows
    // sort AFTER non-null rows. (Under DESC the sign flips and nulls float
    // to the top — an intentional quirk tested in the next case.)
    const a = scored(1, 0.5, { cadd: null } as Partial<ScoredCandidate>)
    const b = scored(2, 0.5, { cadd: 20 } as Partial<ScoredCandidate>)
    expect(compareScoredRows(a, b, [{ key: 'cadd', order: 'asc' }])).toBeGreaterThan(0)
  })

  it('null tie-breaker values float to top under descending order', () => {
    const a = scored(1, 0.5, { cadd: null } as Partial<ScoredCandidate>)
    const b = scored(2, 0.5, { cadd: 20 } as Partial<ScoredCandidate>)
    expect(compareScoredRows(a, b, [{ key: 'cadd', order: 'desc' }])).toBeLessThan(0)
  })

  it('starred beats clinvar pin', () => {
    const starred = scored(1, 0.1, { rank_starred_pinned: true, rank_clinvar_pinned: false })
    const clinvar = scored(2, 0.9, { rank_starred_pinned: false, rank_clinvar_pinned: true })
    expect(compareScoredRows(starred, clinvar)).toBeLessThan(0)
  })
})
