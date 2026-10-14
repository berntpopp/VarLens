import { describe, expect, it } from 'vitest'

import {
  topSpearman,
  averageRanks
} from '../../../../scripts/shortlist-sim/phenotype/gene-ranking-report'
import {
  choose,
  frontier,
  greedy,
  summarize,
  TUNING_STEPS,
  type Overrides,
  type SettingSummary,
  type TuneCase
} from '../../../../scripts/shortlist-sim/phenotype/tuning'

const S = (objective: number, e2Drop: number, e0Ok = true): SettingSummary => ({
  objective,
  baselineObjective: 0.3,
  e2Drop,
  e0Ok,
  feasible: e0Ok && e2Drop <= 0.02
})

describe('tuning selection', () => {
  it('pre-registers C1 → A1 → B1 → key weight with the agreed grids', () => {
    expect(TUNING_STEPS.map((s) => s.grid.length)).toEqual([3, 7, 12, 3])
  })

  it('maximises the objective among feasible settings', () => {
    expect(choose([S(0.9, 0.05), S(0.7, 0.01), S(0.8, 0.02), S(0.95, 0.0, false)])).toBe(2)
  })

  it('falls back to the smallest E2 drop among E0-non-inferior settings', () => {
    expect(choose([S(0.9, 0.05), S(0.7, 0.03), S(0.8, 0.03), S(0.95, 0.01, false)])).toBe(2)
    expect(choose([S(0.9, 0.05, false), S(0.7, 0.04, false)])).toBe(1)
  })

  it('keeps only non-dominated settings on the frontier, by E2 drop', () => {
    expect(frontier([S(0.9, 0.05), S(0.7, 0.01), S(0.6, 0.02), S(0.8, 0.03)])).toEqual([1, 3, 0])
  })

  it('searches greedily, carrying each choice into the next step', () => {
    const seen: Overrides[] = []
    const r = greedy(
      [
        { label: 'a', grid: [{ a: 1 }, { a: 2 }] },
        { label: 'b', grid: [{ b: 1 }, { b: 2 }] }
      ],
      (o) => {
        seen.push(o)
        return S(Number(o.a) + Number(o.b ?? 0), 0)
      }
    )
    expect(r.chosen).toEqual({ a: 2, b: 2 })
    expect(seen.slice(2)).toEqual([
      { a: 2, b: 1 },
      { a: 2, b: 2 }
    ])
    expect(r.path.map((p) => p.pick)).toEqual([1, 1])
  })

  it('summarises hits per arm and level on the training subset only', () => {
    const hit = { higher: 0, equal: 0, rho: 0, rhoDiseases: 0 }
    const miss = { ...hit, higher: 100 }
    const cases: TuneCase[] = []
    const st: number[] = []
    for (const fold of [0, 1])
      for (const level of ['clean', 'moderate', 'noisy'] as const)
        for (const arm of ['E0', 'E1', 'E2'] as const) {
          cases.push({
            meta: { disease: `D${fold}`, level, arm, fold },
            baseline: arm === 'E1' ? miss : hit
          })
          // fold 0: rank 1 except E2 (rank 101); fold 1 misses everything
          st.push(fold === 0 && arm !== 'E2' ? 0 : 100, 0)
        }
    const train = cases.flatMap((c, i) => (c.meta.fold === 0 ? [i] : []))
    const s = summarize(cases, Int32Array.from(st), train)
    expect(s.objective).toBe(1)
    expect(s.baselineObjective).toBe(0)
    expect(s.e2Drop).toBe(1)
    expect(s.e0Ok).toBe(true)
    expect(s.feasible).toBe(false)
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
