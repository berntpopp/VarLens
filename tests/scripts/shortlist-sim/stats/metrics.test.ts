import { describe, expect, it } from 'vitest'

import {
  burden,
  caseTieHit,
  caseTieReciprocal,
  clusterSensitivityCounts,
  decoyIntrusion,
  filterSensitivity,
  hitAtK,
  macroAverage,
  meanHitAtK,
  median,
  medianRank,
  mrr,
  rankCdf,
  caseHit,
  tieAveragedHit,
  tieAveragedReciprocal
} from '../../../../scripts/shortlist-sim/stats/metrics'
import { caseResult } from './fixtures'

describe('hitAtK', () => {
  it('needs every allele within k and treats null as a miss', () => {
    expect(hitAtK([3, 40], 10)).toBe(0)
    expect(hitAtK([3, 9], 10)).toBe(1)
    expect(hitAtK([null], 10)).toBe(0)
    expect(hitAtK([10], 10)).toBe(1)
    expect(hitAtK([2, null], 10)).toBe(0)
  })
})

describe('tie-averaged metrics (equal = other tied rows, itself excluded)', () => {
  it('P(rank ≤ k) under random tie order', () => {
    expect(tieAveragedHit(0, 19, 10)).toBeCloseTo(0.5, 12) // 20 tied leaders
    expect(tieAveragedHit(9, 0, 10)).toBe(1)
    expect(tieAveragedHit(9, 1, 10)).toBe(0.5)
    expect(tieAveragedHit(10, 4, 10)).toBe(0)
    expect(tieAveragedHit(5, 9, 10)).toBeCloseTo(0.5, 12)
  })

  it('E[1/rank] is the exact harmonic mean over tied positions', () => {
    expect(tieAveragedReciprocal(0, 1)).toBeCloseTo((1 + 1 / 2) / 2, 12)
    expect(tieAveragedReciprocal(3, 0)).toBeCloseTo(1 / 4, 12)
    expect(tieAveragedReciprocal(2, 2)).toBeCloseTo((1 / 3 + 1 / 4 + 1 / 5) / 3, 12)
  })

  it('compound het in one tie group: both within the first j of m positions', () => {
    // two causal alleles tied among 4 rows (each sees 3 others), k = 2 → C(2,2)/C(4,2) = 1/6
    const both = [
      { rank: 1, higher: 0, equal: 3 },
      { rank: 2, higher: 0, equal: 3 }
    ]
    expect(caseTieHit(both, 2)).toBeCloseTo(1 / 6, 12)
    expect(caseTieHit(both, 4)).toBe(1)
    // E[1/max]: P(max=j) = 2(j−1)/(m(m−1)) → (2/12)(1/2) + (4/12)(1/3) + (6/12)(1/4)
    expect(caseTieReciprocal(both)).toBeCloseTo(1 / 12 + 1 / 9 + 1 / 8, 12)
  })

  it('compound het in different tie groups multiplies independent CDFs', () => {
    const a = [
      { rank: 1, higher: 0, equal: 1 },
      { rank: 5, higher: 4, equal: 1 }
    ]
    expect(caseTieHit(a, 5)).toBeCloseTo(0.5, 12)
    expect(caseTieReciprocal(a)).toBeCloseTo((1 / 5 + 1 / 6) / 2, 12)
  })

  it('rejects alleles sharing a tie group that is too small for them', () => {
    const bad = [
      { rank: 1, higher: 0, equal: 0 },
      { rank: 1, higher: 0, equal: 0 }
    ]
    expect(() => caseTieHit(bad, 10)).toThrow(/inconsistent tie stats/)
  })

  it('absent allele → 0', () => {
    expect(caseTieHit([{ rank: null, higher: 0, equal: 0 }], 10)).toBe(0)
    expect(caseTieReciprocal([{ rank: null, higher: 0, equal: 0 }])).toBe(0)
  })
})

describe('aggregates', () => {
  const cases = [
    caseResult({ ranks: [1], consequenceClass: 'lof', decoysTop10: 2, eligible: 10 }),
    caseResult({ ranks: [4], consequenceClass: 'missense', eligible: 30 }),
    caseResult({ ranks: [20], consequenceClass: 'missense', decoysTop10: 1, eligible: 20 }),
    caseResult({ ranks: [null], consequenceClass: 'other', causalEligible: [false], eligible: 40 })
  ]

  it('MRR, median rank, CDF', () => {
    expect(mrr(cases)).toBeCloseTo((1 + 1 / 4 + 1 / 20 + 0) / 4, 12)
    expect(medianRank(cases)).toBe(12)
    expect(median([1, Infinity, Infinity])).toBe(Infinity)
    expect(rankCdf(cases, [1, 10, 50])).toEqual([
      { k: 1, share: 0.25 },
      { k: 10, share: 0.5 },
      { k: 50, share: 0.75 }
    ])
    expect(meanHitAtK(cases, 5)).toBe(0.5)
  })

  it('macro-averages over consequence classes', () => {
    // lof 1, missense 0.5, other 0 → 0.5 (pooled micro mean would be 0.5 too; change weights)
    expect(macroAverage(cases, caseHit(10))).toBeCloseTo((1 + 0.5 + 0) / 3, 12)
    const skewed = [...cases, caseResult({ ranks: [2], consequenceClass: 'lof' })]
    expect(macroAverage(skewed, caseHit(10))).toBeCloseTo(0.5, 12)
    expect(meanHitAtK(skewed, 10)).toBeCloseTo(0.6, 12)
  })

  it('decoy intrusion, sensitivity, burden', () => {
    expect(decoyIntrusion(cases)).toEqual({ mean: 0.75, shareAny: 0.5 })
    expect(filterSensitivity(cases)).toBe(0.75)
    expect(burden(cases)).toBe(25)
  })

  it('cluster sensitivity counts a cluster once and fails it on any gated-out allele', () => {
    const cs = [
      caseResult({ gene: 'A', causalEligible: [true] }),
      caseResult({ gene: 'A', causalEligible: [true, false] }),
      caseResult({ gene: 'B', causalEligible: [true] })
    ]
    expect(clusterSensitivityCounts(cs)).toEqual({ n: 2, failures: 1 })
  })
})
