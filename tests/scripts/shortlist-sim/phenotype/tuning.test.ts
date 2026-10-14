import { describe, expect, it } from 'vitest'

import {
  averageRanks,
  topSpearman
} from '../../../../scripts/shortlist-sim/phenotype/gene-ranking-report'
import {
  EXTERNAL_STEPS,
  greedy,
  type Overrides
} from '../../../../scripts/shortlist-sim/phenotype/tuning'

describe('external tuning search', () => {
  it('pre-registers τ → correction × exclusion mode → ε × λ_z', () => {
    expect(EXTERNAL_STEPS.map((s) => s.grid.length)).toEqual([3, 20, 12])
    const b1 = EXTERNAL_STEPS[2].when!
    expect(b1({ correction: 'z', exclusionMode: 'penalty' })).toBe(true)
    expect(b1({ correction: 'z', exclusionMode: 'conflictsOnly' })).toBe(false)
    expect(b1({ correction: 'mean', exclusionMode: 'penalty' })).toBe(false)
  })

  it('carries each choice into the next step and keeps the earlier point on ties', () => {
    const seen: Overrides[] = []
    const r = greedy(
      [
        { label: 'a', grid: [{ a: 1 }, { a: 2 }, { a: 3 }] },
        { label: 'b', grid: [{ b: 1 }, { b: 2 }] }
      ],
      (o) => {
        seen.push(o)
        return Math.min(Number(o.a), 2) + Number(o.b ?? 0)
      }
    )
    expect(r.chosen).toEqual({ a: 2, b: 2 })
    expect(r.objective).toBe(4)
    expect(seen.slice(3)).toEqual([
      { a: 2, b: 1 },
      { a: 2, b: 2 }
    ])
  })

  it('skips a step whose condition does not hold', () => {
    const r = greedy(
      [
        { label: 'a', grid: [{ a: 1 }] },
        { label: 'b', grid: [{ b: 1 }], when: (o) => o.a === 2 }
      ],
      () => 1
    )
    expect(r.path.map((p) => p.label)).toEqual(['a'])
    expect(r.chosen).toEqual({ a: 1 })
  })
})

describe('top-gene breadth ρ', () => {
  it('ranks only the best-scored genes', () => {
    const scores = Float64Array.from([5, 4, 3, -Infinity, 1])
    // among the top 3, score and term count are perfectly anti-correlated
    const counts = Float64Array.from([1, 2, 3, 100, 0])
    expect(topSpearman(scores, counts, 3)).toBeCloseTo(-1)
    expect([...averageRanks(Float64Array.from([2, 1]))]).toEqual([2, 1])
  })
})
