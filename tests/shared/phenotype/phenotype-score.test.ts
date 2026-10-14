import { describe, expect, it } from 'vitest'
import { HPO_SCORING_CONFIG as C } from '../../../src/shared/config/hpo-scoring.config'
import {
  buildPhenotypeIndex,
  type PhenotypeIndexInput
} from '../../../src/shared/phenotype/phenotype-index'
import { explainGene, scoreCase } from '../../../src/shared/phenotype/phenotype-score'
import type { HpoProfileTerm } from '../../../src/shared/types/hpo-profile'
import { naiveScores } from './naive-phenotype-score'
import {
  exclusionLr,
  nullParams,
  scoringOptions
} from '../../../src/shared/phenotype/phenotype-calibration'
import { computeDiseaseNull } from '../../../src/shared/phenotype/phenotype-null'

const ROOT = 'HP:0000118'
const P = (hpoId: string, key = false): HpoProfileTerm => ({ hpoId, excluded: false, key })
const X = (hpoId: string): HpoProfileTerm => ({ hpoId, excluded: true, key: false })

/**
 * Toy ontology (IC exact in float32): ROOT ⊃ HEAD(1) ⊃ SIZE(2) ⊃ {MICRO(4), MACRO(4)};
 * ROOT ⊃ NEURO(1) ⊃ SEIZ(2) ⊃ FEB(4); ROOT ⊃ EYE(1) ⊃ CAT(4); NEURO ⊃ HYPO(3);
 * HEAD ⊃ FACE(2) (second head term for the per-system max).
 */
const terms = {
  HEAD: 1,
  SIZE: 2,
  MICRO: 4,
  MACRO: 4,
  NEURO: 1,
  SEIZ: 2,
  FEB: 4,
  EYE: 1,
  CAT: 4,
  HYPO: 3,
  FACE: 2
}
const edges: Array<[string, string]> = [
  ['HEAD', ROOT],
  ['SIZE', 'HEAD'],
  ['MICRO', 'SIZE'],
  ['MACRO', 'SIZE'],
  ['NEURO', ROOT],
  ['SEIZ', 'NEURO'],
  ['FEB', 'SEIZ'],
  ['EYE', ROOT],
  ['CAT', 'EYE'],
  ['HYPO', 'NEURO'],
  ['FACE', 'HEAD']
]

function toy(
  diseases: Record<string, Array<[string, number, number]>>,
  nots: Array<[string, string]> = []
): PhenotypeIndexInput {
  return {
    terms: [
      { id: ROOT, ic: 0, label: 'root' },
      ...Object.entries(terms).map(([id, ic]) => ({ id, ic, label: `label ${id}` }))
    ],
    edges,
    aliases: [['ALIAS_FEB', 'FEB']],
    diseases: Object.keys(diseases).map((d) => [d, `name ${d}`] as const),
    diseaseTerms: Object.entries(diseases).flatMap(([d, list]) =>
      list.map(([t, f, fx]) => [d, t, f, fx] as const)
    ),
    diseaseNot: nots,
    geneDiseases: Object.keys(diseases).map((d) => [`G_${d}`, d] as const)
  }
}

/** Scores of every gene (G_<disease>) for a profile. */
/** The penalty code paths these hand-computed cases cover (shipped defaults: conflicts only, τ 1). */
const PENALTY = { exclusionMode: 'penalty', tau: 0 } as const

function scores(input: PhenotypeIndexInput, profile: HpoProfileTerm[]): Record<string, number> {
  const ix = buildPhenotypeIndex(input)
  const cs = scoreCase(ix, profile, PENALTY)!
  return Object.fromEntries([...ix.genes].map(([g, i]) => [g.slice(2), cs.geneScore[i]]))
}

describe('phenotype score v2: hand-computed toy cases', () => {
  it('scores a 1-term exact match with f₀ shrinkage on the reverse half', () => {
    // fwd = 4·1/4 = 1 (f = 1 → factor 1); rev = 1·(4/4)/(f₀ + 1) = 0.5.
    const s = scores(toy({ d: [['FEB', 1, 0.95]] }), [P('FEB')])
    expect(s.d).toBeCloseTo(C.gamma + (1 - C.gamma) * (1 / (C.f0 + 1)), 12)
  })

  it('penalises only descendants of an excluded term, never siblings', () => {
    const input = toy({ micro: [['MICRO', 0.9, 0.8]], macro: [['MACRO', 0.9, 0.8]] })
    const plain = scores(input, [P('FACE')])
    const excl = scores(input, [P('FACE'), X('MICRO')])
    expect(plain.macro).toBeGreaterThan(0)
    expect(excl.macro).toBeCloseTo(plain.macro, 12)
    expect(excl.micro).toBeCloseTo(plain.micro * Math.exp(-C.lambda * Math.fround(0.8)), 12)
  })

  it('drops an excluded ancestor of a present term and canonicalises aliases', () => {
    const input = toy({ d: [['FEB', 0.9, 0.8]] })
    const plain = scores(input, [P('FEB')])
    expect(scores(input, [P('ALIAS_FEB'), X('SEIZ'), X('FEB')]).d).toBeCloseTo(plain.d, 12)
  })

  it('never lowers a disease matching a broad key term', () => {
    const input = toy({ d: [['SEIZ', 0.9, 0.8]] })
    const plain = scores(input, [P('SEIZ'), P('CAT')])
    const keyed = scores(input, [P('SEIZ', true), P('CAT')])
    expect(keyed.d).toBeGreaterThan(plain.d)
  })

  it('prunes a present ancestor, handing its key weight to the descendant', () => {
    const input = toy({ d: [['FEB', 0.9, 0.8]], e: [['CAT', 0.9, 0.8]] })
    expect(scores(input, [P('SEIZ', true), P('FEB'), P('CAT')])).toEqual(
      scores(input, [P('FEB', true), P('CAT')])
    )
  })

  it('adds 1 to the load for a NOT annotation that is an ancestor-or-self of a present term', () => {
    const input = toy({ d: [['HYPO', 0.9, 0.8]] }, [['d', 'SEIZ']])
    const unaffected = toy({ d: [['HYPO', 0.9, 0.8]] })
    const ratio =
      scores(input, [P('FEB'), P('HYPO')]).d / scores(unaffected, [P('FEB'), P('HYPO')]).d
    expect(ratio).toBeCloseTo(Math.exp(-C.lambda), 12)
    // A NOT on a descendant of the present term does not contradict it.
    const conflictsOnly = scoreCase(buildPhenotypeIndex(input), [P('FEB'), P('HYPO')], {
      ...PENALTY,
      exclusionMode: 'conflictsOnly'
    })!
    expect(conflictsOnly.geneScore[0]).toBeCloseTo(scores(unaffected, [P('FEB'), P('HYPO')]).d, 12)
    const below = toy({ d: [['HYPO', 0.9, 0.8]] }, [['d', 'FEB']])
    expect(scores(below, [P('SEIZ')]).d).toBeCloseTo(scores(unaffected, [P('SEIZ')]).d, 12)
  })

  it('takes the per-organ-system max, sums systems, and caps the load', () => {
    const d = {
      d: [
        ['MICRO', 0.9, 0.8],
        ['FACE', 0.6, 0.5],
        ['FEB', 0.9, 0.95],
        ['CAT', 0.9, 0.95]
      ]
    }
    const input = toy(d as Record<string, Array<[string, number, number]>>)
    const base = scores(input, [P('HYPO')]).d
    // Two head exclusions: max(0.8, 0.5) = 0.8, not 1.3.
    expect(scores(input, [P('HYPO'), X('MICRO'), X('FACE')]).d / base).toBeCloseTo(
      Math.exp(-C.lambda * Math.fround(0.8)),
      12
    )
    // Head 0.8 + neuro 0.95 + eye 0.95 = 2.7 → capped at E_max.
    expect(scores(input, [P('HYPO'), X('MICRO'), X('FEB'), X('CAT')]).d / base).toBeCloseTo(
      Math.exp(-C.lambda * C.eMax),
      12
    )
  })

  it('penalises only near-obligate known features under the gate; conflictsOnly never penalises', () => {
    const input = toy({
      obligate: [['MICRO', 0.95, 0.8]],
      frequent: [['MICRO', 0.6, 0.4]],
      unknown: [['MICRO', C.missing.f, C.missing.fExcl]]
    })
    const ix = buildPhenotypeIndex(input)
    const run = (o: Parameters<typeof scoreCase>[2]): Record<string, number> => {
      const cs = scoreCase(ix, [P('FACE'), X('MICRO')], { ...PENALTY, ...o })!
      return Object.fromEntries([...ix.genes].map(([g, i]) => [g.slice(2), cs.geneScore[i]]))
    }
    const none = run({ exclusionMode: 'conflictsOnly' })
    for (const v of Object.values(none)) expect(v).toBeGreaterThan(0)
    const gated = run({ excludeMinFrequency: 0.8 })
    expect(gated.obligate).toBeCloseTo(none.obligate * Math.exp(-C.lambda * Math.fround(0.8)), 12)
    expect(gated.frequent).toBeCloseTo(none.frequent, 12)
    expect(gated.unknown).toBeCloseTo(none.unknown, 12)
    // A missing frequency never penalises under a gate, even below its 0.35 default.
    expect(run({ excludeMinFrequency: 0.3 }).unknown).toBeCloseTo(none.unknown, 12)
    // Ungated (default), the missing-frequency annotation penalises with f_excl 0.15.
    expect(run({}).unknown).toBeCloseTo(none.unknown * Math.exp(-C.lambda * Math.fround(0.15)), 12)
    const cs = scoreCase(ix, [P('FACE'), X('MICRO')], { exclusionMode: 'conflictsOnly' })!
    expect(explainGene(ix, cs, ix.genes.get('G_frequent')!).conflicts).toHaveLength(1)
    expect(cs.geneConflicts[ix.genes.get('G_unknown')!]).toBe(1)
  })

  it('ships conflicts-only exclusions and τ = 1: an excluded term never changes a score', () => {
    expect(C.exclusionMode).toBe('conflictsOnly')
    expect(C.tau).toBe(1)
    expect(C.backgroundCorrection).toBe('off')
    const input = toy(
      {
        d: [
          ['MICRO', 0.95, 0.8],
          ['FEB', 0.9, 0.8]
        ]
      },
      [['d', 'SEIZ']]
    )
    const ix = buildPhenotypeIndex(input)
    const plain = scoreCase(ix, [P('FACE')])!
    const excluded = scoreCase(ix, [P('FACE'), P('FEB'), X('MICRO')])!
    const withFeb = scoreCase(ix, [P('FACE'), P('FEB')])!
    expect(excluded.geneScore[0]).toBe(withFeb.geneScore[0])
    expect(plain.geneScore[0]).toBeGreaterThan(0)
    expect(explainGene(ix, excluded, 0).conflicts).toEqual([
      expect.objectContaining({ excludedTerm: 'MICRO', diseaseTerm: 'MICRO' })
    ])
  })

  it('is inactive without a present term', () => {
    const ix = buildPhenotypeIndex(toy({ d: [['FEB', 0.9, 0.8]] }))
    expect(scoreCase(ix, [X('FEB')])).toBeNull()
    expect(scoreCase(ix, [P('UNKNOWN'), P(ROOT)])).toBeNull()
  })

  it('explains the best disease with matched pairs, key flags, conflicts and the percentile', () => {
    const input = toy({
      a: [
        ['FEB', 0.9, 0.8],
        ['MICRO', 0.9, 0.8]
      ],
      b: [['CAT', 0.5, 0.3]]
    })
    input.geneDiseases = [
      ['G1', 'a'],
      ['G1', 'b'],
      ['G2', 'b']
    ]
    const ix = buildPhenotypeIndex(input)
    const cs = scoreCase(ix, [P('FEB', true), P('HYPO'), X('SIZE')])!
    const e = explainGene(ix, cs, ix.genes.get('G1')!)!
    expect(e).toMatchObject({ diseaseId: 'a', diseaseLabel: 'name a', percentile: 0.5 })
    expect(e.matched).toEqual([
      {
        patientTerm: 'FEB',
        patientLabel: 'label FEB',
        diseaseTerm: 'FEB',
        diseaseLabel: 'label FEB',
        key: true,
        frequency: Math.fround(0.9)
      }
    ])
    expect(e.conflicts).toEqual([
      {
        excludedTerm: 'SIZE',
        excludedLabel: 'label SIZE',
        diseaseTerm: 'MICRO',
        diseaseLabel: 'label MICRO',
        frequency: Math.fround(0.8)
      }
    ])
    expect(cs.geneConflicts[ix.genes.get('G1')!]).toBe(1)
  })
})

describe('background correction helpers', () => {
  it('computes the error-tolerant exclusion LR (research values at ε = 0.1)', () => {
    expect(exclusionLr(0.5, 0, 0.1)).toBeCloseTo(-Math.log(0.55), 12)
    expect(exclusionLr(0.9, 0, 0.1)).toBeCloseTo(-Math.log(0.19), 12)
    expect(exclusionLr(1, 0, 0.1)).toBeCloseTo(-Math.log(0.1), 12)
    expect(exclusionLr(0.1, 0.5, 0.1)).toBe(0)
  })

  it('builds a deterministic null with μ in [0, 1] for every size', () => {
    const ix = buildPhenotypeIndex(
      toy({
        a: [['FEB', 0.9, 0.8]],
        b: [
          ['CAT', 0.5, 0.3],
          ['HYPO', 1, 0.95]
        ]
      })
    )
    const one = computeDiseaseNull(ix, 0, 20, 7)
    expect(computeDiseaseNull(ix, 0, 20, 7)).toEqual(one)
    expect(one.mu).toHaveLength(2 * C.nullMaxK)
    for (const m of one.mu) expect(m).toBeGreaterThanOrEqual(0)
    for (const m of one.mu) expect(m).toBeLessThanOrEqual(1)
    for (const s of one.sd) expect(s).toBeGreaterThanOrEqual(0)
  })
})

describe('phenotype score v2 equals the naive reference (seeded fuzz)', () => {
  it('matches score, best disease and explanation sets on random DAGs', () => {
    let seed = 0xc0ffee
    const rand = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000
    const int = (n: number): number => Math.floor(rand() * n)
    const pick = <V>(xs: readonly V[]): V => xs[int(xs.length)]
    let compared = 0
    for (let round = 0; round < 300; round++) {
      const n = 4 + int(40)
      const ids = [ROOT, ...Array.from({ length: n }, (_, i) => `T${i}`)]
      const edges: Array<[string, string]> = []
      for (let i = 1; i < ids.length; i++) {
        // Parents have lower indices: acyclic, with chains, diamonds and multi-system terms.
        const k = rand() < 0.25 ? 1 + int(3) : 1
        for (const p of new Set(Array.from({ length: k }, () => int(i))))
          edges.push([ids[i], ids[p]])
      }
      const monotone = rand() < 0.5
      const depth = new Map<string, number>([[ROOT, 0]])
      for (const [c, p] of edges) depth.set(c, Math.max(depth.get(c) ?? 0, depth.get(p)! + 1))
      const input: PhenotypeIndexInput = {
        terms: ids.map((id) => ({
          id,
          ic: id === ROOT ? 0 : rand() < 0.1 ? 0 : monotone ? depth.get(id)! + rand() : rand() * 5,
          label: id
        })),
        edges,
        aliases: [['ALIAS', pick(ids.slice(1))]],
        diseases: [],
        diseaseTerms: [],
        diseaseNot: [],
        geneDiseases: []
      }
      const diseases = Array.from({ length: 2 + int(8) }, (_, d) => `D${d}`)
      const freqs = [0.025, 0.17, 0.35, 0.545, 0.6, 0.895, 1]
      for (const d of diseases) {
        input.diseases.push([d, d])
        const own = new Set(Array.from({ length: 1 + int(6) }, () => pick(ids.slice(1))))
        for (const t of own) {
          const f = pick(freqs)
          if (rand() < 0.15) input.diseaseTerms.push([d, t, C.missing.f, C.missing.fExcl])
          else input.diseaseTerms.push([d, t, f, rand() < 0.2 ? 0 : f * rand()])
        }
        if (rand() < 0.3) input.diseaseNot.push([d, pick(ids)])
      }
      for (let g = 0; g < 6; g++) {
        for (const d of new Set(Array.from({ length: 1 + int(3) }, () => pick(diseases)))) {
          input.geneDiseases.push([`G${g}`, d])
        }
      }
      const profile = Array.from({ length: 1 + int(8) }, () => ({
        hpoId: rand() < 0.1 ? pick(['ALIAS', 'UNKNOWN', ROOT]) : pick(ids),
        excluded: rand() < 0.35,
        key: rand() < 0.3
      }))
      const options = scoringOptions({
        correction: pick(['off', 'mean', 'z'] as const),
        tau: pick([0, 0.5, 1]),
        geneMaxPenalty: pick([0, 0.5, 1]),
        lrEpsilon: pick([0.05, 0.1, 0.3]),
        lambdaZ: pick([0.25, 0.5, 1]),
        excludeMinFrequency: pick([0, 0, 0.3, 0.8]),
        exclusionMode: pick(['penalty', 'penalty', 'conflictsOnly'] as const)
      })
      // Random stored null (some diseases without one, some σ = 0) for the options' τ.
      const K = C.nullMaxK
      input.diseaseNull = diseases
        .filter(() => rand() < 0.9)
        .map((d) => {
          const mu = Float32Array.from({ length: K }, () => rand() * 0.9)
          const sd = Float32Array.from({ length: K }, () => (rand() < 0.1 ? 0 : rand() * 0.3))
          return [d, mu, sd] as const
        })
      input.nullParams = nullParams(options.tau)
      const ix = buildPhenotypeIndex(input)
      const fast = scoreCase(ix, profile, options)
      const want = naiveScores(input, profile, options)
      if (want === null) {
        expect(fast).toBeNull()
        continue
      }
      expect(fast).not.toBeNull()
      expect(ix.genes.size).toBe(want.size)
      for (const [gene, g] of ix.genes) {
        const ref = want.get(gene)!
        expect(Math.abs(fast!.geneScore[g] - ref.score)).toBeLessThan(1e-12)
        const ranked = [...ref.diseases].sort((a, b) => b.score - a.score)
        if (ranked.length > 1 && ranked[0].score - ranked[1].score < 1e-9) continue
        const e = explainGene(ix, fast!, g)!
        expect(e.diseaseId).toBe(ref.best)
        expect(
          new Set(e.matched.map((m) => `${m.patientTerm}>${m.diseaseTerm}${m.key ? '*' : ''}`))
        ).toEqual(ref.matched)
        expect(new Set(e.conflicts.map((c) => `${c.excludedTerm}>${c.diseaseTerm}`))).toEqual(
          ref.conflicts
        )
        expect(fast!.geneConflicts[g]).toBe(ref.conflicts.size)
        compared++
      }
    }
    expect(compared).toBeGreaterThan(300)
  })
})
