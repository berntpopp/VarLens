import { describe, expect, it } from 'vitest'

import { rng } from '../../../../scripts/shortlist-sim/common/rng'
import {
  averageRanks,
  spearman
} from '../../../../scripts/shortlist-sim/phenotype/gene-ranking-report'
import {
  frequencyWeight,
  generalise,
  generateProfile,
  NOISE_LEVELS,
  parseDiseases,
  profileOntology,
  type Disease
} from '../../../../scripts/shortlist-sim/phenotype/profiles'
import { ancestorClosure, type HpOntology } from '../../../../src/shared/phenotype/hpo-sources'

// Synthetic ontology: HP:0000001 > HP:0000118 > A1 > {B1, B2}; B1 > C1; A2 (sibling of A1).
const T = (n: number): string => `HP:${String(n).padStart(7, '0')}`
const [ROOT, PA, A1, A2, B1, B2, C1] = [1, 118, 10, 20, 11, 12, 111].map(T)
const hp: HpOntology = {
  version: null,
  labels: new Map([ROOT, PA, A1, A2, B1, B2, C1].map((t) => [t, t])),
  parents: new Map([
    [PA, [ROOT]],
    [A1, [PA]],
    [A2, [PA]],
    [B1, [A1]],
    [B2, [A1]],
    [C1, [B1]]
  ]),
  aliases: new Map()
}
const ancestors = ancestorClosure(hp)
const ont = profileOntology(hp, ancestors)
const disease: Disease = {
  id: 'OMIM:1',
  terms: new Map([
    [C1, 1],
    [B2, 0.5],
    [A2, 0.1]
  ]),
  genes: ['G1']
}

describe('profile generator', () => {
  it('is deterministic per seed and shares true terms across noise levels', () => {
    const a = generateProfile(disease, NOISE_LEVELS.noisy, ont, rng(7))
    expect(generateProfile(disease, NOISE_LEVELS.noisy, ont, rng(7))).toEqual(a)
    const clean = generateProfile(disease, NOISE_LEVELS.clean, ont, rng(7))
    expect(new Set(clean)).toEqual(new Set([C1, B2, A2]))
  })

  it('maps an imprecise term to a strict ancestor below HP:0000118', () => {
    for (let seed = 0; seed < 20; seed++) {
      const up = generalise(C1, 2, ont, rng(seed))
      expect(up).not.toBe(C1)
      expect(ancestors.get(C1)).toContain(up)
      expect([PA, ROOT]).not.toContain(up)
    }
    expect(generalise(A1, 3, ont, rng(1))).toBe(A1) // never climbs to HP:0000118
  })

  it('draws noise terms only from the phenotypic-abnormality subtree', () => {
    expect(ont.abnormalities).toEqual([A1, A2, B1, B2, C1].sort())
    const level = { imprecision: 0, steps: 0, noise: 50 }
    for (const t of generateProfile(disease, level, ont, rng(3))) {
      expect(ont.isAbnormality.has(t)).toBe(true)
    }
  })
})

describe('annotation parsing', () => {
  it('maps HPO frequency classes, ratios and percentages to weights', () => {
    expect(frequencyWeight('HP:0040281')).toBe(0.9)
    expect(frequencyWeight('HP:0040285')).toBe(0)
    expect(frequencyWeight('3/4')).toBe(0.75)
    expect(frequencyWeight('20%')).toBe(0.2)
    expect(frequencyWeight('')).toBe(0.5)
  })

  it('keeps OMIM/ORPHA diseases with genes and positive phenotype rows only', () => {
    const hpoa = [
      'database_id\tdisease_name\tqualifier\thpo_id\tfrequency\taspect',
      `OMIM:1\tx\t\t${C1}\t1/2\tP`,
      `OMIM:1\tx\tNOT\t${B2}\t\tP`,
      `OMIM:1\tx\t\t${A2}\tHP:0040285\tP`,
      `OMIM:1\tx\t\tHP:0000006\t\tI`,
      `OMIM:2\ty\t\t${C1}\t\tP`,
      `DECIPHER:3\tz\t\t${C1}\t\tP`
    ].join('\n')
    const g2p = [
      'gene_symbol\thpo_id\tdisease_id',
      `G1\t${C1}\tOMIM:1`,
      `G3\t${C1}\tDECIPHER:3`
    ].join('\n')
    expect(parseDiseases(hpoa, g2p)).toEqual([
      { id: 'OMIM:1', terms: new Map([[C1, 0.5]]), genes: ['G1'] }
    ])
  })
})

describe('rank statistics', () => {
  it('averages ties and handles -Infinity', () => {
    expect([...averageRanks(Float64Array.from([3, -Infinity, 3, 1]))]).toEqual([3.5, 1, 3.5, 2])
    const y = averageRanks(Float64Array.from([1, 2, 3, 4]))
    expect(spearman(Float64Array.from([10, 20, 30, 40]), y)).toBeCloseTo(1)
    expect(spearman(Float64Array.from([4, 3, 2, -Infinity]), y)).toBeCloseTo(-1)
  })
})
