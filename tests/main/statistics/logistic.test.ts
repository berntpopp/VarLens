import { describe, it, expect } from 'vitest'
import {
  firthLogisticRegression,
  logisticRegression,
  twoSidedNormalP
} from '../../../src/main/statistics/logistic'
import goldenRef from '../../fixtures/golden/logistic-reference.json'

describe('logisticRegression (standard)', () => {
  for (const ref of goldenRef) {
    it(`matches golden reference: ${ref.name}`, () => {
      const covariates = ref.covariates
        ? ref.burden.map((_: number, i: number) => [(ref.covariates as number[])[i]])
        : undefined
      const result = logisticRegression(ref.burden, ref.y, covariates)

      expect(result.converged).toBe(ref.converged)
      expect(result.beta).toBeCloseTo(ref.beta, 3)
      expect(result.se).toBeCloseTo(ref.se, 2)
      // Relative accuracy: an absolute-decimal check cannot see a tail p-value collapse to 0.
      expect(Math.abs(Math.log(result.p_value / ref.p_value))).toBeLessThan(1e-3)
      expect(result.ci_lower).toBeCloseTo(ref.ci_lower, 1)
      expect(result.ci_upper).toBeCloseTo(ref.ci_upper, 1)
    })
  }
})

describe('twoSidedNormalP', () => {
  // Reference values: mpmath erfc(|z| / sqrt(2)) at 30 digits.
  const reference: Array<[number, number]> = [
    [0, 1],
    [1.959963984540054, 0.05],
    [5, 5.7330314375838782e-7],
    [8.3, 1.0411139489780508e-16],
    [-10, 1.52397060483211e-23],
    [20, 5.507248237212467e-89],
    [37, 1.1451142445049154e-299]
  ]
  for (const [z, p] of reference) {
    it(`matches 2*Q(|${z}|) to relative 1e-9`, () => {
      expect(Math.abs(twoSidedNormalP(z) / p - 1)).toBeLessThan(1e-9)
    })
  }
})

describe('separated gene tail p-values', () => {
  // 2,000 samples, carriers [800 cases, 200 controls] vs [200 cases, 800 controls]: z ~ 26.
  const burden: number[] = []
  const y: number[] = []
  const push = (carrier: number, outcome: number, count: number): void => {
    for (let i = 0; i < count; i++) {
      burden.push(carrier)
      y.push(outcome)
    }
  }
  push(1, 1, 800)
  push(1, 0, 200)
  push(0, 1, 200)
  push(0, 0, 800)

  for (const [name, fit] of [
    ['standard', logisticRegression],
    ['firth', firthLogisticRegression]
  ] as const) {
    it(`${name} returns 0 < p < 1e-15`, () => {
      const result = fit(burden, y, undefined)
      expect(result.p_value).toBeGreaterThan(0)
      expect(result.p_value).toBeLessThan(1e-15)
      // Wald p from the fitted z, in log space.
      const expected = twoSidedNormalP(result.beta / result.se)
      expect(Math.abs(Math.log(result.p_value / expected))).toBeLessThan(1e-9)
    })
  }
})
