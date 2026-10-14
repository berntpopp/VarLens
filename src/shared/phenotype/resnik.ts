/**
 * Resnik semantic similarity between a patient's HPO profile and a gene's
 * annotated phenotypes (#600). Pure: the ontology lookups are injected.
 */
export interface HpoOntology {
  /** Current id of a phenotype-subtree term (alt / obsolete ids resolved); undefined otherwise. */
  canonical(term: string): string | undefined
  /** is_a ancestors of a canonical term including itself, within the phenotype subtree. */
  ancestors(term: string): readonly string[]
  /** Information content of `term` (0 when unannotated). */
  ic(term: string): number
}

/** Canonical, deduplicated phenotype terms; unknown and non-phenotype terms are dropped. */
export function canonicalTerms(terms: readonly string[], ontology: HpoOntology): string[] {
  const out = new Set<string>()
  for (const term of terms) {
    const id = ontology.canonical(term)
    if (id !== undefined) out.add(id)
  }
  return [...out]
}

/**
 * Symmetric best-match average: the mean of the patient→gene and gene→patient
 * averages of each term's best `sim` on the other side (the Phenomizer / pyhpo
 * "BMA" form). The one-sided patient→gene average rewards heavily annotated
 * genes and collapses under noisy profiles (Hit@10 14.3 % vs 32.1 % symmetric:
 * `.planning/artifacts/shortlist-sim/2026-10-14-resnik/gene-ranking.md`).
 * Null when either side is empty.
 */
export function symmetricBestMatchAverage(
  patient: readonly string[],
  gene: readonly string[],
  sim: (patientTerm: string, geneTerm: string) => number
): number | null {
  if (patient.length === 0 || gene.length === 0) return null
  const geneBest = new Array<number>(gene.length).fill(0)
  let patientSum = 0
  for (const p of patient) {
    let best = 0
    gene.forEach((g, j) => {
      const s = sim(p, g)
      if (s > best) best = s
      if (s > geneBest[j]) geneBest[j] = s
    })
    patientSum += best
  }
  const geneSum = geneBest.reduce((a, b) => a + b, 0)
  return (patientSum / patient.length + geneSum / gene.length) / 2
}

/** Resnik sim(a, b) = IC of the most informative common ancestor (MICA). */
export function resnikSimilarity(a: string, b: string, ontology: HpoOntology): number {
  const other = new Set(ontology.ancestors(b))
  let best = 0
  for (const anc of ontology.ancestors(a)) {
    if (other.has(anc)) best = Math.max(best, ontology.ic(anc))
  }
  return best
}

/** Symmetric Resnik BMA of patient vs gene terms; null without known phenotype terms on either side. */
export function resnikBestMatchAverage(
  patientTerms: readonly string[],
  geneTerms: readonly string[],
  ontology: HpoOntology
): number | null {
  return symmetricBestMatchAverage(
    canonicalTerms(patientTerms, ontology),
    canonicalTerms(geneTerms, ontology),
    (p, g) => resnikSimilarity(p, g, ontology)
  )
}
