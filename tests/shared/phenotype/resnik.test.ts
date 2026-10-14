import { describe, expect, it } from 'vitest'
import {
  informationContent,
  parseGenesToPhenotype,
  parseHpJson,
  parseHpoaDiseaseTerms,
  phenotypeClosure
} from '../../../src/shared/phenotype/hpo-sources'
import {
  buildHpoIndex,
  scoreAllGenes,
  type HpoIndexInput
} from '../../../src/shared/phenotype/resnik'
import { GENES_TO_PHENOTYPE, HP_JSON, PHENOTYPE_HPOA, T } from './hpo-fixture'

const ontology = parseHpJson(HP_JSON)
const ancestors = phenotypeClosure(ontology)
const diseases = parseHpoaDiseaseTerms(PHENOTYPE_HPOA)
const ic = informationContent(diseases, ancestors)
const L43 = Math.log(4 / 3)
const LN2 = Math.log(2)

/** The fixture's phenotype subtree as index input, with the given gene annotations. */
function toyInput(geneTerms: Array<[string, string]>): HpoIndexInput {
  const terms = [...ontology.labels.keys()].filter((t) => ancestors.has(t))
  return {
    terms: terms.map((id) => ({ id, ic: ic.get(id) ?? 0 })),
    edges: terms.flatMap((t) => (ontology.parents.get(t) ?? []).map((p) => [t, p] as const)),
    aliases: [...ontology.aliases],
    geneTerms
  }
}

/** Naive reference: explicit ancestor sets, pairwise MICA, symmetric best-match average. */
function naiveScore(input: HpoIndexInput, patient: string[], gene: string[]): number | null {
  const parents = new Map<string, string[]>()
  for (const [c, p] of input.edges) parents.set(c, [...(parents.get(c) ?? []), p])
  const icOf = new Map(input.terms.map((t) => [t.id, t.ic]))
  const alias = new Map(input.aliases)
  const anc = (t: string): Set<string> => {
    const out = new Set([t])
    const stack = [t]
    while (stack.length > 0) {
      for (const p of parents.get(stack.pop()!) ?? []) {
        if (!out.has(p)) stack.push(p)
        out.add(p)
      }
    }
    return out
  }
  const canon = (ts: string[]): string[] => [
    ...new Set(ts.map((t) => alias.get(t) ?? t).filter((t) => icOf.has(t)))
  ]
  const ps = canon(patient)
  const gs = canon(gene)
  if (ps.length === 0 || gs.length === 0) return null
  const sim = (a: string, b: string): number => {
    const bAnc = anc(b)
    return Math.max(0, ...[...anc(a)].filter((x) => bAnc.has(x)).map((x) => icOf.get(x)!))
  }
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length
  const fwd = mean(ps.map((p) => Math.max(...gs.map((g) => sim(p, g)))))
  const rev = mean(gs.map((g) => Math.max(...ps.map((p) => sim(p, g)))))
  return (fwd + rev) / 2
}

/** Fast score of `patient` against one gene annotated with `gene`. */
function fast(patient: string[], gene: string[]): number | null {
  const ix = buildHpoIndex(toyInput(gene.map((t) => ['G', t])))
  const g = ix.genes.get('G')
  const scores = scoreAllGenes(ix, patient)
  return g === undefined || scores === null ? null : scores[g]
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

  it('refuses an is_a cycle in the index', () => {
    const input = toyInput([])
    expect(() => buildHpoIndex({ ...input, edges: [...input.edges, [T.P, T.C]] })).toThrow(/cycle/)
  })

  it('rejects a file without the required columns', () => {
    expect(() => parseGenesToPhenotype('a\tb\n1\t2', diseases)).toThrow(/Missing columns/)
  })
})

describe('scoreAllGenes (symmetric Resnik BMA over the DAG)', () => {
  it('averages the patient→gene and gene→patient best-match averages', () => {
    // →: C~D = A ln(4/3), E~D = 0; ←: D best ln(4/3).
    expect(fast([T.C, T.E], [T.D])).toBeCloseTo((L43 / 2 + L43) / 2, 12)
    expect(fast([T.C, T.E], [T.C, T.E])).toBeCloseTo(LN2, 12)
  })

  it('is symmetric', () => {
    expect(fast([T.D], [T.C, T.E])).toBeCloseTo(fast([T.C, T.E], [T.D])!, 12)
  })

  it('finds the MICA through either parent of a DAG diamond', () => {
    // F~D via C→A = ln(4/3); F~E via E = ln 2.
    expect(fast([T.F], [T.D])).toBeCloseTo(L43, 12)
    expect(fast([T.F], [T.D, T.E])).toBeCloseTo((LN2 + (L43 + LN2) / 2) / 2, 12)
  })

  it('canonicalises and deduplicates patient terms, following alias chains', () => {
    const plain = fast([T.C, T.E], [T.D])!
    expect(fast([T.C, T.ALT, T.E, T.Z, T.Z2], [T.D])).toBeCloseTo(plain, 12)
    expect(fast([T.ALT, T.Z2], [T.D])).toBeCloseTo(plain, 12)
  })

  it('ignores unknown and non-phenotype terms, including in the denominator', () => {
    const plain = fast([T.C], [T.C, T.E])!
    expect(plain).toBeCloseTo((LN2 + LN2 / 2) / 2, 12)
    expect(fast([T.C, T.INH, 'HP:9999999'], [T.C, T.E])).toBeCloseTo(plain, 12)
    expect(fast([T.INH], [T.C])).toBeNull()
    expect(fast([T.C], [])).toBeNull()
  })

  it('equals the naive pairwise reference on random DAGs (seeded fuzz)', () => {
    let seed = 0x5eed
    const rand = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000
    const pick = <V>(xs: readonly V[]): V => xs[Math.floor(rand() * xs.length)]
    for (let round = 0; round < 60; round++) {
      const n = 3 + Math.floor(rand() * 40)
      const ids = Array.from({ length: n }, (_, i) => `T${i}`)
      const monotone = rand() < 0.5
      const edges: Array<[string, string]> = []
      const depth: number[] = [0]
      for (let i = 1; i < n; i++) {
        // Parents always have a lower index: acyclic; chains, diamonds and multi-parent terms.
        const k = rand() < 0.2 ? 1 + Math.floor(rand() * 3) : 1
        const ps = new Set(Array.from({ length: k }, () => Math.floor(rand() * i)))
        for (const p of ps) edges.push([ids[i], ids[p]])
        depth.push(1 + Math.max(...[...ps].map((p) => depth[p])))
      }
      const input: HpoIndexInput = {
        // Shuffled, so the input order is not already a topological order (as in the DB).
        terms: ids
          .map((id, i) => ({ id, ic: monotone ? depth[i] + rand() : rand() * 5, key: rand() }))
          .sort((a, b) => a.key - b.key)
          .map(({ id, ic }) => ({ id, ic })),
        edges,
        aliases: [['ALIAS', pick(ids)]],
        geneTerms: Array.from({ length: 8 }, (_, g) =>
          Array.from(
            { length: 1 + Math.floor(rand() * 6) },
            () => [`G${g}`, pick(ids)] as [string, string]
          )
        ).flat()
      }
      const ix = buildHpoIndex(input)
      const patient = Array.from({ length: 1 + Math.floor(rand() * 6) }, () =>
        rand() < 0.1 ? pick(['ALIAS', 'UNKNOWN']) : pick(ids)
      )
      const scores = scoreAllGenes(ix, patient)
      for (const [gene, g] of ix.genes) {
        const terms = input.geneTerms.filter(([x]) => x === gene).map(([, t]) => t)
        const want = naiveScore(input, patient, terms)
        if (want === null) expect(scores).toBeNull()
        else expect(Math.abs(scores![g] - want)).toBeLessThan(1e-12)
      }
    }
  })
})
