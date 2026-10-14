import { describe, expect, it } from 'vitest'

import { rng } from '../../../../scripts/shortlist-sim/common/rng'
import {
  ARM_CONFIG,
  armProfile,
  drawArms,
  topMimics,
  type ArmContext
} from '../../../../scripts/shortlist-sim/phenotype/arms'
import {
  renderGeneRanking,
  type GeneRankCase
} from '../../../../scripts/shortlist-sim/phenotype/gene-ranking-report'
import type { Disease, SampledProfile } from '../../../../scripts/shortlist-sim/phenotype/profiles'
import { componentFolds } from '../../../../scripts/shortlist-sim/stats/folds'
import { ancestorClosure, type HpOntology } from '../../../../src/shared/phenotype/hpo-sources'

// Synthetic ontology under HP:0000118 (PA): A > {A1, A2}, A1 > A11; B > {B1, B2, B3}; C > C1.
const T = (n: number): string => `HP:${String(n).padStart(7, '0')}`
const [PA, A, A1, A2, A11, B, B1, B2, B3, C, C1] = [
  118, 10, 11, 12, 111, 20, 21, 22, 23, 30, 31
].map(T)
const edges: Array<[string, string]> = [
  [A, PA],
  [A1, A],
  [A2, A],
  [A11, A1],
  [B, PA],
  [B1, B],
  [B2, B],
  [B3, B],
  [C, PA],
  [C1, C]
]
const hp: HpOntology = {
  version: null,
  labels: new Map([PA, A, A1, A2, A11, B, B1, B2, B3, C, C1].map((t) => [t, t])),
  parents: new Map(edges.map(([c, p]) => [c, [p]])),
  aliases: new Map()
}
const ancestors = ancestorClosure(hp)
const ctx: ArmContext = {
  ancestors,
  ic: (t) => (t === A2 ? 3 : 1),
  isAbnormality: new Set([...hp.labels.keys()].filter((t) => t !== PA))
}
// True disease: A11 (f 1), A2 (f 0.6), C1 (f 0.8). Mimics carry frequent B features and A1 (in closure).
const disease: Disease = {
  id: 'OMIM:1',
  terms: new Map([
    [A11, 1],
    [A2, 0.6],
    [C1, 0.8]
  ]),
  genes: ['G1']
}
const mimics: Disease[] = [
  {
    id: 'OMIM:2',
    terms: new Map([
      [B1, 0.9],
      [B2, 0.7],
      [A1, 1],
      [B3, 0.3]
    ]),
    genes: ['G2']
  },
  {
    id: 'OMIM:3',
    terms: new Map([
      [B3, 0.69],
      [C, 1]
    ]),
    genes: ['G3']
  }
]
const truth = [A11, A2]
const sampled: SampledProfile = { truth, reported: [A1, A2], noise: [B3, C] }

describe('arm generators', () => {
  it('excludes only frequent mimic features outside the true ancestor closure', () => {
    const closure = new Set([...disease.terms.keys()].flatMap((t) => ancestors.get(t) ?? []))
    for (let seed = 0; seed < 50; seed++) {
      const d = drawArms(disease, truth, mimics, ctx, rng(seed))
      expect(ARM_CONFIG.exclusionCounts).toContain(d.exclusions.length)
      for (const e of d.exclusions) {
        expect([B1, B2]).toContain(e) // A1/C are in the closure, B3 is too rare
        expect(closure.has(e)).toBe(false)
      }
      expect(d.exclusions.length).toBe(2) // only two candidates exist
    }
  })

  it('marks the true terms with the highest f·IC key', () => {
    const counts = new Set<number>()
    for (let seed = 0; seed < 50; seed++) {
      const d = drawArms(disease, truth, mimics, ctx, rng(seed))
      counts.add(d.keyTruth.length)
      expect(d.keyTruth[0]).toBe(A2) // 0.6 × 3 > 1 × 1
      for (const k of d.keyTruth) expect(truth).toContain(k)
    }
    expect([...counts].sort()).toEqual([1, 2])
  })

  it('draws the E2 false exclusion from frequent true features outside Anc(truth)', () => {
    const d = drawArms(disease, truth, mimics, ctx, rng(1))
    expect(d.falseExclusion).toBe(C1) // A2 is a sampled true term; A11's f = 1 is out of range
    expect(drawArms(disease, [A11, A2, C1], mimics, ctx, rng(1)).falseExclusion).toBeNull()
  })

  it('builds E0/E1/E2 profiles: keys on reported terms, exclusions never present', () => {
    const d = { ...drawArms(disease, truth, mimics, ctx, rng(3)), noiseKey: true, noiseKeyPick: 0 }
    const e0 = armProfile('E0', sampled, d, 'noisy')
    expect(e0).toEqual([A1, A2, B3, C].map((hpoId) => ({ hpoId, excluded: false, key: false })))
    const e1 = armProfile('E1', sampled, d, 'noisy')
    expect(e1.filter((t) => !t.excluded)).toHaveLength(4)
    expect(e1.filter((t) => t.excluded).map((t) => t.hpoId)).toEqual(d.exclusions)
    expect(e1.find((t) => t.hpoId === A2)?.key).toBe(true)
    if (d.keyTruth.includes(A11)) expect(e1.find((t) => t.hpoId === A1)?.key).toBe(true)
    const e2 = armProfile('E2', sampled, d, 'noisy')
    expect(e2.filter((t) => t.excluded)).toHaveLength(d.exclusions.length + 1)
    expect(e2.find((t) => t.hpoId === B3)?.key).toBe(true) // noise term marked key
    expect(armProfile('E2', sampled, d, 'moderate').find((t) => t.hpoId === B3)?.key).toBe(false)
    const clash = armProfile('E1', { ...sampled, noise: [d.exclusions[0]] }, d, 'noisy')
    expect(clash.filter((t) => t.hpoId === d.exclusions[0])).toEqual([
      { hpoId: d.exclusions[0], excluded: false, key: false }
    ])
  })

  it('is deterministic per seed', () => {
    expect(drawArms(disease, truth, mimics, ctx, rng(9))).toEqual(
      drawArms(disease, truth, mimics, ctx, rng(9))
    )
  })

  it('picks the top mimics outside the excluded set, ties by id', () => {
    const scores = Float64Array.from([5, 9, 9, 1])
    expect(topMimics(scores, ['D', 'C', 'B', 'A'], new Set(['B']), 2)).toEqual(['C', 'D'])
  })
})

describe('component folds', () => {
  it('keeps connected genes together and balances fold sizes', () => {
    const folds = componentFolds(
      [
        ['G1', 'D1'],
        ['G2', 'D1'],
        ['G2', 'D2'],
        ['G3', 'D2'],
        ['G4', 'D3'],
        ['G5', 'D4'],
        ['G6', 'D5']
      ],
      3
    )
    expect(folds.get('G1')).toBe(folds.get('G2'))
    expect(folds.get('G2')).toBe(folds.get('G3'))
    const sizes = [0, 1, 2].map((f) => [...folds.values()].filter((x) => x === f).length)
    expect(sizes).toEqual([3, 2, 1])
  })
})

describe('report', () => {
  it('renders every stratum and a ship table', () => {
    const cases: GeneRankCase[] = []
    for (const disease of ['D1', 'D2', 'D3'])
      for (const level of ['clean', 'moderate', 'noisy'] as const)
        for (const arm of ['E0', 'E1', 'E2'] as const) {
          const s = { higher: 0, equal: 0, rho: 0.1, rhoDiseases: 0.1 }
          cases.push({
            disease,
            level,
            arm,
            fold: 0,
            geneDiseases: 1,
            present: 5,
            excluded: 0,
            keys: 0,
            falseExclusion: false,
            noiseKey: false,
            ms: 1,
            scorers: { v2: s, sprint3: s }
          })
        }
    const md = renderGeneRanking(cases, {
      release: 'r',
      diseases: 3,
      eligible: 3,
      genes: 9,
      foldGenes: [9]
    })
    expect(md).toContain('### noisy × E2')
    expect(md).toContain('| 1. E1 moderate: ΔHit@10 vs sprint 3 (pp) | 0.0 [0.0, 0.0] |')
    expect(md).toContain('**Verdict: NO SHIP.**')
  })
})
