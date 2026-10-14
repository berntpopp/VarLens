/**
 * Resnik semantic similarity between a patient's HPO profile and a gene's
 * annotated phenotypes (#600). Pure: the ontology lookups are injected.
 */
export interface HpoOntology {
  /** is_a ancestors of `term` including itself; undefined for an unknown term. */
  ancestors(term: string): readonly string[] | undefined
  /** Information content of `term` (0 when unannotated). */
  ic(term: string): number
}

/**
 * sim(a, b) = IC of the most informative common ancestor (MICA).
 * Gene score = patient→gene best-match average (asymmetric): the mean over
 * the patient's known terms of max_g sim(p, g) over the gene's terms g.
 * Since max_g IC(MICA(p, g)) = max IC over anc(p) ∩ ⋃_g anc(g), one ancestor
 * union per gene replaces the pairwise loop. Null when no patient term is
 * known or the gene has no known terms.
 */
export function resnikBestMatchAverage(
  patientTerms: readonly string[],
  geneTerms: readonly string[],
  ontology: HpoOntology
): number | null {
  const geneAncestors = new Set<string>()
  for (const term of geneTerms) {
    for (const anc of ontology.ancestors(term) ?? []) geneAncestors.add(anc)
  }
  if (geneAncestors.size === 0) return null
  let sum = 0
  let known = 0
  for (const term of patientTerms) {
    const ancestors = ontology.ancestors(term)
    if (ancestors === undefined) continue
    let best = 0
    for (const anc of ancestors) {
      if (geneAncestors.has(anc)) best = Math.max(best, ontology.ic(anc))
    }
    sum += best
    known++
  }
  return known === 0 ? null : sum / known
}
