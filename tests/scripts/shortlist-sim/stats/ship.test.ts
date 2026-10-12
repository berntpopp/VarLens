import { describe, expect, it } from 'vitest'

import {
  evaluateShip,
  pooledModes,
  type ShipInputs
} from '../../../../scripts/shortlist-sim/stats/ship'

const iv = (lo: number, hi: number) => ({ estimate: (lo + hi) / 2, lo, hi })
const passing: ShipInputs = {
  testGeneClusters: 400,
  modeCases: { AD: 500, AR_HOM: 400, AR_COMPHET: 100, XLD: 12 },
  primary: { deltaHit10: iv(0.05, 0.12), deltaDecoys: iv(-0.2, 0.3) },
  clinvarVisible: { deltaHit10: iv(-0.01, 0.04), deltaDecoys: iv(-0.1, 0.2) },
  sensitivity: { n: 400, failures: 0 }
}

describe('evaluateShip (spec §11.5)', () => {
  it('passes when every bound holds; small mode strata are dropped, not failing', () => {
    const v = evaluateShip(passing)
    expect(v.ship).toBe(true)
    expect(v.reasons).toEqual([])
    expect(v.droppedModes).toEqual(['XLD'])
    expect(v.pooledModes).toEqual(['AD', 'AR_HOM', 'AR_COMPHET'])
    expect(v.sensitivityLower).toBeCloseTo(0.025 ** (1 / 400), 12)
  })

  it.each([
    ['power_clusters', { testGeneClusters: 299 }],
    ['primary_hit10', { primary: { ...passing.primary, deltaHit10: iv(0.03, 0.1) } }],
    ['primary_decoys', { primary: { ...passing.primary, deltaDecoys: iv(0, 0.51) } }],
    [
      'visible_hit10',
      { clinvarVisible: { ...passing.clinvarVisible, deltaHit10: iv(-0.02, 0.1) } }
    ],
    ['visible_decoys', { clinvarVisible: { ...passing.clinvarVisible, deltaDecoys: iv(0, 0.6) } }],
    ['sensitivity', { sensitivity: { n: 400, failures: 6 } }],
    ['power_modes', { modeCases: { AD: 29 } }]
  ] as Array<[string, Partial<ShipInputs>]>)('fails on %s with a reason', (id, patch) => {
    const v = evaluateShip({ ...passing, ...patch })
    expect(v.ship).toBe(false)
    expect(v.checks.filter((c) => !c.pass).map((c) => c.id)).toEqual([id])
    expect(v.reasons).toHaveLength(1)
  })

  it('NaN bounds never pass', () => {
    const v = evaluateShip({
      ...passing,
      primary: { ...passing.primary, deltaHit10: iv(Number.NaN, Number.NaN) }
    })
    expect(v.ship).toBe(false)
  })

  it('pooledModes keeps strata with ≥ 30 cases in fixed order', () => {
    expect(pooledModes({ XLD: 30, AD: 31, AR_HOM: 3 })).toEqual(['AD', 'XLD'])
  })
})
