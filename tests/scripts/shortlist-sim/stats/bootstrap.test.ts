import { describe, expect, it } from 'vitest'

import {
  clusterBootstrap,
  pairedClusterBootstrap,
  quantile
} from '../../../../scripts/shortlist-sim/stats/bootstrap'
import { geneFolds } from '../../../../scripts/shortlist-sim/stats/folds'
import { mulberry32 } from '../../../../scripts/shortlist-sim/stats/prng'

const meanOf = (xs: Array<{ v: number }>): number => xs.reduce((s, x) => s + x.v, 0) / xs.length

describe('clusterBootstrap', () => {
  it('is deterministic per seed', () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ g: `g${i % 12}`, v: (i * i) % 7 }))
    const a = clusterBootstrap(items, (x) => x.g, meanOf, 500, 42)
    const b = clusterBootstrap(items, (x) => x.g, meanOf, 500, 42)
    const c = clusterBootstrap(items, (x) => x.g, meanOf, 500, 43)
    expect(a).toEqual(b)
    expect(c).not.toEqual(a)
    expect(a.lo).toBeLessThanOrEqual(a.estimate)
    expect(a.hi).toBeGreaterThanOrEqual(a.estimate)
  })

  it('resamples whole clusters', () => {
    // Two clusters: every replicate mean is one of 0, 0.5 (mixed, from 10 zeros + 10 ones) or 1.
    const items = [
      ...Array.from({ length: 10 }, () => ({ g: 'zero', v: 0 })),
      ...Array.from({ length: 10 }, () => ({ g: 'one', v: 1 }))
    ]
    const seen = new Set<number>()
    clusterBootstrap(
      items,
      (x) => x.g,
      (s) => {
        const m = meanOf(s)
        seen.add(m)
        return m
      },
      300,
      7
    )
    expect([...seen].sort()).toEqual([0, 0.5, 1])
  })

  it('paired difference uses the same clusters for both sets', () => {
    // b is a shifted copy of a: every paired replicate difference is exactly the shift.
    const a = Array.from({ length: 40 }, (_, i) => ({ g: `g${i % 8}`, v: i % 3 }))
    const b = a.map((x) => ({ ...x, v: x.v - 0.25 }))
    const d = pairedClusterBootstrap(a, b, (x) => x.g, meanOf, 400, 3)
    expect(d.estimate).toBeCloseTo(0.25, 12)
    expect(d.lo).toBeCloseTo(0.25, 12)
    expect(d.hi).toBeCloseTo(0.25, 12)
  })

  it('quantile interpolates linearly', () => {
    expect(quantile([0, 10], 0.25)).toBe(2.5)
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3)
  })
})

describe('mulberry32 and geneFolds', () => {
  it('generates uniform-ish values deterministically', () => {
    const r1 = mulberry32(1)
    const r2 = mulberry32(1)
    const xs = Array.from({ length: 1000 }, () => r1())
    expect(xs).toEqual(Array.from({ length: 1000 }, () => r2()))
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...xs)).toBeLessThan(1)
    expect(xs.reduce((s, x) => s + x, 0) / 1000).toBeCloseTo(0.5, 1)
  })

  it('assigns balanced folds, independent of input order and duplicates', () => {
    const genes = Array.from({ length: 23 }, (_, i) => `G${i}`)
    const f = geneFolds(genes, 5, 9)
    expect(geneFolds([...genes].reverse().concat('G1'), 5, 9)).toEqual(f)
    const sizes = [0, 1, 2, 3, 4].map((k) => [...f.values()].filter((v) => v === k).length)
    expect(sizes.sort()).toEqual([4, 4, 5, 5, 5])
    expect(geneFolds(genes, 5, 10)).not.toEqual(f)
    expect(() => geneFolds(genes, 0, 1)).toThrow()
  })
})
