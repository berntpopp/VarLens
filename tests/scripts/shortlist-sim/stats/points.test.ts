import { describe, expect, it } from 'vitest'

import { estimatePoints, roundPoints } from '../../../../scripts/shortlist-sim/stats/points'

const bins = (b10 = 1) => [
  { id: 'x', a: 30, b: 10 * b10, isReference: false },
  { id: 'y', a: 10, b: 40 * b10, isReference: false },
  { id: 'ref', a: 60, b: 950 * b10, isReference: true }
]
const byId = (r: ReturnType<typeof estimatePoints>) => Object.fromEntries(r.map((p) => [p.id, p]))

describe('estimatePoints (spec §11.1)', () => {
  it('hand-computed example', () => {
    // x: log2(30.5/60.5) − log2(10.5/950.5) = 5.5121 → 5.5; y: log2(10.5/60.5) − log2(40.5/950.5) = 2.0261 → 2
    const r = byId(estimatePoints(bins(), 100, 1000))
    expect(r.x.raw).toBeCloseTo(5.512099494158083, 12)
    expect(r.x.points).toBe(5.5)
    expect(r.y.raw).toBeCloseTo(2.0261469992680925, 12)
    expect(r.y.points).toBe(2)
    expect(r.ref.points).toBe(0)
    expect(r.ref.supported).toBe(true)
  })

  it('is replication-invariant up to smoothing (all b × 10)', () => {
    const small = byId(estimatePoints(bins(1), 100, 1000))
    const big = byId(estimatePoints(bins(10), 100, 10000))
    expect(big.x.raw - small.x.raw).toBeCloseTo(0.0625, 3) // smoothing only, at small b
    const large = [
      { id: 'x', a: 3000, b: 1000, isReference: false },
      { id: 'ref', a: 6000, b: 95000, isReference: true }
    ]
    const largeX10 = large.map((x) => ({ ...x, b: x.b * 10 }))
    const l1 = estimatePoints(large, 9000, 96000)[0].raw
    const l10 = estimatePoints(largeX10, 9000, 960000)[0].raw
    expect(Math.abs(l10 - l1)).toBeLessThan(0.001)
  })

  it('a bin with a + b < 10 gets 0; the rest of the group keeps its points', () => {
    const r = byId(
      estimatePoints([{ id: 'thin', a: 4, b: 5, isReference: false }, ...bins()], 100, 1000)
    )
    expect(r.thin.supported).toBe(false)
    expect(r.thin.points).toBe(0)
    expect(r.x.points).toBe(5.5)
  })

  it('a reference with a < 5 or b < 5 zeroes the whole group', () => {
    for (const ref of [
      { id: 'ref', a: 4, b: 900, isReference: true },
      { id: 'ref', a: 60, b: 4, isReference: true }
    ]) {
      const r = estimatePoints([bins()[0], bins()[1], ref], 100, 1000)
      expect(r.every((p) => p.points === 0 && !p.supported)).toBe(true)
    }
  })

  it('needs exactly one reference', () => {
    expect(() => estimatePoints(bins().slice(0, 2), 100, 1000)).toThrow()
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
