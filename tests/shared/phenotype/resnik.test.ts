import { describe, expect, it } from 'vitest'
import {
  ancestorClosure,
  informationContent,
  parseGenesToPhenotype,
  parseHpJson,
  parseHpoaDiseaseTerms
} from '../../../src/shared/phenotype/hpo-sources'
import { resnikBestMatchAverage, type HpoOntology } from '../../../src/shared/phenotype/resnik'
import { GENES_TO_PHENOTYPE, HP_JSON, PHENOTYPE_HPOA, T } from './hpo-fixture'

const ontology = parseHpJson(HP_JSON)
const ancestors = ancestorClosure(ontology)
const ic = informationContent(parseHpoaDiseaseTerms(PHENOTYPE_HPOA), ancestors)
const toy: HpoOntology = { ancestors: (t) => ancestors.get(t), ic: (t) => ic.get(t) ?? 0 }

describe('HPO source parsing', () => {
  it('keeps non-deprecated HP classes, is_a edges only, and the release date', () => {
    expect(ontology.version).toBe('2026-09-01')
    expect([...ontology.labels.keys()].sort()).toEqual([T.R, T.A, T.B, T.C, T.D, T.E])
    expect(ontology.parents.get(T.C)).toEqual([T.A])
  })

  it('maps alternative ids and replaced obsolete terms onto the current term', () => {
    expect(ontology.aliases).toEqual(
      new Map([
        [T.ALT, T.C],
        [T.Z, T.E]
      ])
    )
    expect(ancestors.get(T.ALT)).toEqual(ancestors.get(T.C))
    expect(ancestors.get(T.Z)).toEqual(ancestors.get(T.E))
    expect(resnikBestMatchAverage([T.ALT, T.Z], [T.D], toy)).toBeCloseTo(
      resnikBestMatchAverage([T.C, T.E], [T.D], toy)!,
      12
    )
  })

  it('closes ancestors including self', () => {
    expect(new Set(ancestors.get(T.C))).toEqual(new Set([T.C, T.A, T.R]))
    expect(ancestors.get(T.R)).toEqual([T.R])
  })

  it('computes annotation IC with propagation, skipping NOT and non-P rows', () => {
    expect(ic.get(T.R)).toBeCloseTo(0, 12)
    expect(ic.get(T.A)).toBeCloseTo(Math.log(4 / 3), 12)
    expect(ic.get(T.B)).toBeCloseTo(Math.log(2), 12)
    expect(ic.get(T.C)).toBeCloseTo(Math.log(2), 12)
    expect(ic.get(T.D)).toBeCloseTo(Math.log(4), 12)
    expect(ic.get(T.E)).toBeCloseTo(Math.log(2), 12)
  })

  it('groups distinct gene terms', () => {
    const genes = parseGenesToPhenotype(GENES_TO_PHENOTYPE)
    expect(genes.get('GENE2')).toEqual(new Set([T.C, T.E]))
  })

  it('rejects a file without the required columns', () => {
    expect(() => parseGenesToPhenotype('a\tb\n1\t2')).toThrow(/Missing columns/)
  })
})

describe('resnikBestMatchAverage (patient → gene)', () => {
  it('averages the per-patient-term best MICA IC', () => {
    // C vs {D}: MICA A = ln(4/3); E vs {D}: MICA R = 0.
    expect(resnikBestMatchAverage([T.C, T.E], [T.D], toy)).toBeCloseTo(Math.log(4 / 3) / 2, 12)
    // C vs {C,E}: C = ln 2; E vs {C,E}: E = ln 2.
    expect(resnikBestMatchAverage([T.C, T.E], [T.C, T.E], toy)).toBeCloseTo(Math.log(2), 12)
  })

  it('is asymmetric', () => {
    expect(resnikBestMatchAverage([T.D], [T.C, T.E], toy)).toBeCloseTo(Math.log(4 / 3), 12)
  })

  it('ignores unknown patient terms; null without known terms on either side', () => {
    expect(resnikBestMatchAverage([T.C, 'HP:9999999'], [T.C], toy)).toBeCloseTo(Math.log(2), 12)
    expect(resnikBestMatchAverage(['HP:9999999'], [T.C], toy)).toBeNull()
    expect(resnikBestMatchAverage([T.C], [], toy)).toBeNull()
  })
})
