import { describe, expect, it } from 'vitest'

import { estimatePoints, roundPoints } from '../../../../scripts/shortlist-sim/stats/points'

const bins = (b10 = 1) => [
  { id: 'x', a: 30, b: 10 * b10, isReference: false },
  { id: 'y', a: 10, b: 40 * b10, isReference: false },
  { id: 'ref', a: 60, b: 950 * b10, isReference: true }
]
const byId = (r: ReturnType<typeof estimatePoints>) => Object.fromEntries(r.map((p) => [p.id, p]))

describe('estimatePoints (spec §14–15 anchor rule)', () => {
  it('hand-computed example: anchor = bin with the most positives', () => {
    // anchor ref (a = 60). K = 3, so the K/2 terms cancel in differences:
    // x: log2(30.5/60.5) − log2(10.5/950.5) = 5.5121 → 5.5; y: 2.0261 → 2
    const r = byId(estimatePoints(bins(), 100, 1000))
    expect(r.ref.isAnchor).toBe(true)
    expect(r.x.raw).toBeCloseTo(5.512099494158083, 12)
    expect(r.x.points).toBe(5.5)
    expect(r.y.raw).toBeCloseTo(2.0261469992680925, 12)
    expect(r.y.points).toBe(2)
    expect(r.ref.points).toBe(0)
    expect(r.ref.supported).toBe(true)
  })

  it('the catch-all gets its own estimate when another bin is the anchor', () => {
    // Positives never fall in the catch-all (a = 0) — the case that degenerated under §11.1.
    const r = byId(
      estimatePoints(
        [
          { id: 'big', a: 80, b: 900, isReference: false },
          { id: 'mid', a: 20, b: 50, isReference: false },
          { id: 'ref', a: 0, b: 50, isReference: true }
        ],
        100,
        1000
      )
    )
    expect(r.big.isAnchor).toBe(true)
    expect(r.big.points).toBe(0)
    expect(r.ref.supported).toBe(true)
    expect(r.ref.points).toBeLessThan(0)
    expect(r.mid.points).toBeGreaterThan(0)
  })

  it('a bin with no (or < 5) positives never scores above the anchor', () => {
    const r = byId(
      estimatePoints(
        [
          { id: 'plp', a: 100, b: 20, isReference: false },
          { id: 'blb', a: 0, b: 30, isReference: false },
          { id: 'few', a: 3, b: 12, isReference: false },
          { id: 'ref', a: 2, b: 2000, isReference: true }
        ],
        105,
        2062
      )
    )
    expect(r.plp.isAnchor).toBe(true)
    expect(r.blb.points).toBeLessThanOrEqual(0)
    expect(r.few.points).toBeLessThanOrEqual(0)
    expect(r.ref.points).toBeLessThanOrEqual(0)
  })

  it('row ranking is invariant to the anchor choice', () => {
    const counts = bins()
    const viaRef = byId(estimatePoints(counts, 100, 1000, 'ref'))
    const viaX = byId(estimatePoints(counts, 100, 1000, 'x'))
    // Every row gets exactly one bin per group, so a constant shift preserves all differences.
    for (const [p, q] of [
      ['x', 'y'],
      ['y', 'ref'],
      ['x', 'ref']
    ])
      expect(viaRef[p].raw - viaRef[q].raw).toBeCloseTo(viaX[p].raw - viaX[q].raw, 12)
  })

  it('is replication-invariant up to smoothing (all b × 10)', () => {
    const small = byId(estimatePoints(bins(1), 100, 1000))
    const big = byId(estimatePoints(bins(10), 100, 10000))
    expect(big.x.raw - small.x.raw).toBeCloseTo(0.0625, 3) // smoothing only, at small b
  })

  it('a bin with a + b < 10 gets 0; the rest of the group keeps its points', () => {
    const r = byId(
      estimatePoints([{ id: 'thin', a: 4, b: 5, isReference: false }, ...bins()], 100, 1000)
    )
    expect(r.thin.supported).toBe(false)
    expect(r.thin.points).toBe(0)
    expect(r.x.points).toBe(5.5)
  })

  it('a group with fewer than 20 training positives scores 0 throughout', () => {
    const few = bins().map((x) => ({ ...x, a: Math.floor(x.a / 10) }))
    const r = estimatePoints(few, 10, 1000)
    expect(r.every((p) => p.points === 0 && !p.supported)).toBe(true)
  })

  it('rounds to 0.5 symmetrically and clips to ±8', () => {
    expect(roundPoints(1.25)).toBe(1.5)
    expect(roundPoints(-1.25)).toBe(-1.5)
    expect(roundPoints(-0.1)).toBe(0)
    expect(Object.is(roundPoints(-0.1), -0)).toBe(false)
    expect(roundPoints(12)).toBe(8)
    expect(roundPoints(-9.3)).toBe(-8)
  })
})
