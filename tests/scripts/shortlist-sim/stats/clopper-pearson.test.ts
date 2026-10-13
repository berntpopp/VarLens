import { describe, expect, it } from 'vitest'

import {
  betaQuantile,
  clopperPearsonLower,
  regularizedBeta
} from '../../../../scripts/shortlist-sim/stats/clopper-pearson'

// Reference values: scipy 1.17.1, scipy.special.betainc / scipy.stats.beta.ppf(0.025, x, n−x+1).
describe('Clopper–Pearson lower bound', () => {
  it('regularized incomplete beta matches scipy', () => {
    expect(regularizedBeta(0.3, 2.5, 3.5)).toBeCloseTo(0.29675298929566646, 12)
    expect(regularizedBeta(0.45, 30, 40)).toBeCloseTo(0.6447480085585666, 12)
    expect(regularizedBeta(0, 2, 2)).toBe(0)
    expect(regularizedBeta(1, 2, 2)).toBe(1)
  })

  it('boundary cases are exact', () => {
    expect(clopperPearsonLower(0, 10)).toBe(0)
    expect(clopperPearsonLower(50, 50)).toBeCloseTo(0.025 ** (1 / 50), 14)
    expect(clopperPearsonLower(50, 50)).toBeCloseTo(0.9288782635358024, 12)
    expect(clopperPearsonLower(1, 1)).toBeCloseTo(0.025, 14)
  })

  it('interior cases match scipy', () => {
    expect(clopperPearsonLower(7, 20)).toBeCloseTo(0.15390920478454118, 10)
    expect(clopperPearsonLower(290, 300)).toBeCloseTo(0.9395546777987344, 10)
    expect(clopperPearsonLower(997, 1000)).toBeCloseTo(0.9912579767615217, 10)
    expect(betaQuantile(0.5, 2, 2)).toBeCloseTo(0.5, 12)
  })

  it('rejects invalid counts', () => {
    expect(() => clopperPearsonLower(5, 4)).toThrow()
    expect(() => clopperPearsonLower(-1, 4)).toThrow()
    expect(() => clopperPearsonLower(1, 0)).toThrow()
  })
})
