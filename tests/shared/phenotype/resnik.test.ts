import { describe, expect, it } from 'vitest'
import {
  informationContent,
  fractionFrequency,
  parseGeneDiseases,
  parseGenesToPhenotype,
  parseHpJson,
  parseHpoaDiseases,
  parseHpoaDiseaseTerms,
  phenotypeClosure
} from '../../../src/shared/phenotype/hpo-sources'
import { buildHpoIndex, type HpoIndexInput } from '../../../src/shared/phenotype/resnik'
import { GENES_TO_PHENOTYPE, HP_JSON, PHENOTYPE_HPOA, T } from './hpo-fixture'
import { HPO_SCORING_CONFIG } from '../../../src/shared/config/hpo-scoring.config'

const ontology = parseHpJson(HP_JSON)
const ancestors = phenotypeClosure(ontology)
const diseases = parseHpoaDiseaseTerms(PHENOTYPE_HPOA)
const ic = informationContent(diseases, ancestors)
const L43 = Math.log(4 / 3)
const LN2 = Math.log(2)

/** The fixture's phenotype subtree as index input. */
function toyInput(): HpoIndexInput {
  const terms = [...ontology.labels.keys()].filter((t) => ancestors.has(t))
  return {
    terms: terms.map((id) => ({ id, ic: ic.get(id) ?? 0 })),
    edges: terms.flatMap((t) => (ontology.parents.get(t) ?? []).map((p) => [t, p] as const)),
    aliases: [...ontology.aliases]
  }
}

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

  it('links a gene only to diseases with a positive phenotype annotation', () => {
    expect(parseGeneDiseases(GENES_TO_PHENOTYPE, diseases)).toEqual(
      new Map([
        ['GENE1', new Set(['OMIM:2'])],
        ['GENE2', new Set(['OMIM:4', 'OMIM:3'])],
        ['GENE3', new Set(['OMIM:2'])]
      ])
    )
  })

  it('keeps per-pair frequencies, NOT annotations and disease labels', () => {
    const parsed = parseHpoaDiseases(PHENOTYPE_HPOA)
    expect(parsed.terms.get('OMIM:1')?.get(T.C)).toEqual(fractionFrequency(3, 4))
    expect(parsed.terms.get('OMIM:2')?.get(T.D)).toEqual(HPO_SCORING_CONFIG.missing)
    expect(parsed.not).toEqual(
      new Map([
        ['OMIM:1', new Set([T.X])],
        ['OMIM:2', new Set([T.X])],
        ['OMIM:3', new Set([T.X])],
        ['OMIM:4', new Set([T.D])],
        ['OMIM:5', new Set([T.C])]
      ])
    )
    expect(parsed.labels.get('OMIM:1')).toBe('name')
  })

  it('pools fractions, prefers them over categories and maps frequency terms and percentages', () => {
    const header =
      'database_id\tdisease_name\tqualifier\thpo_id\treference\tevidence\tonset\tfrequency\tsex\tmodifier\taspect\tbiocuration'
    const row = (t: string, freq: string, q = ''): string =>
      ['D:1', 'n', q, t, 'PMID:1', 'PCS', '', freq, '', '', 'P', 'x'].join('\t')
    const parsed = parseHpoaDiseases(
      [
        header,
        row(T.C, '1/4'),
        row(T.C, '2/6'),
        row(T.C, 'HP:0040281'),
        row(T.D, 'HP:0040283'),
        row(T.D, 'HP:0040282'),
        row(T.E, '25%'),
        row(T.X, '0/3'),
        row(T.X, 'HP:0040284'),
        row(T.A, '-'),
        row(T.B, '0/5'),
        row(T.F, '1/1', 'NOT'),
        row(T.F, '2/2')
      ].join('\n')
    ).terms.get('D:1')!
    expect(parsed.get(T.C)).toEqual(fractionFrequency(3, 10))
    expect(parsed.get(T.D)).toEqual({ f: 0.545, fExcl: 0.3 })
    expect(parsed.get(T.E)).toEqual({ f: 0.25, fExcl: 0.25 })
    expect(parsed.get(T.X)).toEqual({ f: 0.025, fExcl: 0.01 })
    expect(parsed.get(T.A)).toEqual(HPO_SCORING_CONFIG.missing)
    expect(parsed.has(T.B)).toBe(false)
    expect(parsed.get(T.F)).toEqual(fractionFrequency(2, 2))
  })

  it('pools fractions once per evidence row and onto the current term of an alt id', () => {
    const header =
      'database_id\tdisease_name\tqualifier\thpo_id\treference\tevidence\tonset\tfrequency\tsex\tmodifier\taspect\tbiocuration'
    const row = (t: string, freq: string, ref: string, onset = '', bio = 'x'): string =>
      ['D:1', 'n', '', t, ref, 'PCS', onset, freq, '', '', 'P', bio].join('\t')
    // OMIM:266920 / HP:0003774 in the 2026-09-01 release: one 1/1 row is repeated with
    // different biocuration only; pooled once, f = 0.425 instead of 0.458824.
    const parsed = parseHpoaDiseases(
      [
        header,
        row(T.C, '3/11', 'PMID:1'),
        row(T.C, '2/2', 'PMID:2', 'HP:0003621'),
        row(T.C, '1/1', 'PMID:3', '', 'a'),
        row(T.C, '1/1', 'PMID:3', '', 'b'),
        row('HP:9999999', '1/2', 'PMID:4'),
        row('HP:9999999', '1/1', 'PMID:3', '', 'c')
      ].join('\n'),
      new Map([['HP:9999999', T.C]])
    ).terms.get('D:1')!
    expect(parsed.get(T.C)).toEqual(fractionFrequency(7, 16))
    expect(parsed.has('HP:9999999')).toBe(false)
    expect(fractionFrequency(6, 14).f).toBeCloseTo(0.425, 12)
  })

  it('smooths fractions and takes the Beta 10th percentile as f_excl (scipy reference values)', () => {
    // scipy.stats.beta.ppf(0.1, m + 0.8, n − m + 1.2)
    const cases: Array<[number, number, number, number]> = [
      [1, 1, 0.6, 0.24527408783017812],
      [1, 9, 0.16363636363636364, 0.043965781921507234],
      [49, 50, 0.9576923076923076, 0.9203147603860767],
      [10, 10, 0.9, 0.7847280626238927],
      [100, 200, 0.499009900990099, 0.45396330875877483]
    ]
    for (const [m, n, f, fExcl] of cases) {
      expect(fractionFrequency(m, n).f).toBeCloseTo(f, 12)
      expect(fractionFrequency(m, n).fExcl).toBeCloseTo(fExcl, 9)
    }
  })

  it('refuses an is_a cycle in the index', () => {
    const input = toyInput()
    expect(() => buildHpoIndex({ ...input, edges: [...input.edges, [T.P, T.C]] })).toThrow(/cycle/)
  })

  it('rejects a file without the required columns', () => {
    expect(() => parseGeneDiseases('a\tb\n1\t2', diseases)).toThrow(/Missing columns/)
  })
})
