import { describe, expect, it } from 'vitest'
import {
  informationContent,
  parseGenesToPhenotype,
  parseHpJson,
  parseHpoaDiseaseTerms,
  phenotypeClosure
} from '../../../src/shared/phenotype/hpo-sources'
import { resnikBestMatchAverage, type HpoOntology } from '../../../src/shared/phenotype/resnik'
import { GENES_TO_PHENOTYPE, HP_JSON, PHENOTYPE_HPOA, T } from './hpo-fixture'

const ontology = parseHpJson(HP_JSON)
const ancestors = phenotypeClosure(ontology)
const diseases = parseHpoaDiseaseTerms(PHENOTYPE_HPOA)
const ic = informationContent(diseases, ancestors)
const toy: HpoOntology = {
  canonical: (t) => {
    const id = ontology.aliases.get(t) ?? t
    return ancestors.has(id) ? id : undefined
  },
  ancestors: (t) => ancestors.get(t) ?? [],
  ic: (t) => ic.get(t) ?? 0
}
const L43 = Math.log(4 / 3)
const LN2 = Math.log(2)

describe('HPO source parsing', () => {
  it('keeps non-deprecated HP classes, is_a edges only, and the release date', () => {
    expect(ontology.version).toBe('2026-09-01')
    expect([...ontology.labels.keys()].sort()).toEqual(
      [T.R, T.A, T.B, T.C, T.D, T.E, T.INH, T.F, T.X, T.P].sort()
    )
    expect(ontology.parents.get(T.C)).toEqual([T.A])
  })

  it('maps alternative ids and replaced obsolete terms (following chains) onto the current term', () => {
    expect(ontology.aliases).toEqual(
      new Map([
        [T.ALT, T.C],
        [T.Z, T.E],
        [T.Z2, T.E]
      ])
    )
  })

  it('closes ancestors including self within the Phenotypic abnormality subtree only', () => {
    expect(new Set(ancestors.get(T.C))).toEqual(new Set([T.C, T.A, T.P]))
    expect(new Set(ancestors.get(T.F))).toEqual(new Set([T.F, T.C, T.E, T.A, T.B, T.P]))
    expect(ancestors.has(T.INH)).toBe(false)
    expect(ancestors.has(T.R)).toBe(false)
  })

  it('keeps only positive phenotype annotations: no NOT, zero-frequency or non-P rows', () => {
    expect(diseases).toEqual(
      new Map([
        ['OMIM:1', new Set([T.C])],
        ['OMIM:2', new Set([T.D])],
        ['OMIM:3', new Set([T.E])],
        ['OMIM:4', new Set([T.C, T.E])]
      ])
    )
  })

  it('computes annotation IC with propagation, counting a diamond descendant once', () => {
    expect(ic.get(T.P)).toBeCloseTo(0, 12)
    expect(ic.get(T.A)).toBeCloseTo(L43, 12)
    expect(ic.get(T.B)).toBeCloseTo(LN2, 12)
    expect(ic.get(T.C)).toBeCloseTo(LN2, 12)
    expect(ic.get(T.D)).toBeCloseTo(Math.log(4), 12)
    expect(ic.get(T.E)).toBeCloseTo(LN2, 12)
    expect(ic.has(T.F)).toBe(false)
    // One disease annotated to F reaches P via both parents but counts once.
    const viaDiamond = informationContent(new Map([['d', new Set([T.F])]]), ancestors)
    expect(viaDiamond.get(T.P)).toBeCloseTo(0, 12)
  })

  it('keeps a gene term only when an associated disease supports it positively', () => {
    const genes = parseGenesToPhenotype(GENES_TO_PHENOTYPE, diseases)
    expect(genes).toEqual(
      new Map([
        ['GENE1', new Set([T.D])],
        ['GENE2', new Set([T.C, T.E])],
        ['GENE3', new Set([T.D])]
      ])
    )
  })

  it('rejects a file without the required columns', () => {
    expect(() => parseGenesToPhenotype('a\tb\n1\t2', diseases)).toThrow(/Missing columns/)
  })
})

describe('resnikBestMatchAverage (symmetric BMA)', () => {
  it('averages the patient→gene and gene→patient best-match averages', () => {
    // →: C~D = A ln(4/3), E~D = 0; ←: D best ln(4/3).
    expect(resnikBestMatchAverage([T.C, T.E], [T.D], toy)).toBeCloseTo((L43 / 2 + L43) / 2, 12)
    expect(resnikBestMatchAverage([T.C, T.E], [T.C, T.E], toy)).toBeCloseTo(LN2, 12)
  })

  it('is symmetric', () => {
    expect(resnikBestMatchAverage([T.D], [T.C, T.E], toy)).toBeCloseTo(
      resnikBestMatchAverage([T.C, T.E], [T.D], toy)!,
      12
    )
  })

  it('finds the MICA through either parent of a DAG diamond', () => {
    // F~D via C→A = ln(4/3); F~E via E = ln 2.
    expect(resnikBestMatchAverage([T.F], [T.D], toy)).toBeCloseTo(L43, 12)
    expect(resnikBestMatchAverage([T.F], [T.D, T.E], toy)).toBeCloseTo(
      (LN2 + (L43 + LN2) / 2) / 2,
      12
    )
  })

  it('canonicalises and deduplicates patient terms, following alias chains', () => {
    const plain = resnikBestMatchAverage([T.C, T.E], [T.D], toy)!
    expect(resnikBestMatchAverage([T.C, T.ALT, T.E, T.Z, T.Z2], [T.D], toy)).toBeCloseTo(plain, 12)
    expect(resnikBestMatchAverage([T.ALT, T.Z2], [T.D], toy)).toBeCloseTo(plain, 12)
  })

  it('ignores unknown and non-phenotype terms, including in the denominator', () => {
    const plain = resnikBestMatchAverage([T.C], [T.C, T.E], toy)!
    expect(plain).toBeCloseTo((LN2 + LN2 / 2) / 2, 12)
    expect(resnikBestMatchAverage([T.C, T.INH, 'HP:9999999'], [T.C, T.E], toy)).toBeCloseTo(
      plain,
      12
    )
    expect(resnikBestMatchAverage([T.INH], [T.C], toy)).toBeNull()
    expect(resnikBestMatchAverage([T.C], [], toy)).toBeNull()
  })
})
