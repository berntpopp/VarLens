/**
 * Parsers for the HPO release files behind `hpo_resnik` (#600): hp.json
 * (obographs), phenotype.hpoa and genes_to_phenotype.txt, plus the derived
 * ancestor closure and annotation-based information content. Pure.
 */
import { HPO_DATA_CONFIG } from '../config/hpo-data.config'

export interface HpOntology {
  /** e.g. `2026-09-01`, from the graph's versionIRI; null when absent. */
  version: string | null
  labels: Map<string, string>
  /** term → direct is_a parents (HPO terms only). */
  parents: Map<string, string[]>
  /** Alternative id or obsolete term (replaced_by) → current term. */
  aliases: Map<string, string>
}

interface ObographNode {
  id: string
  lbl?: string
  type?: string
  meta?: { deprecated?: boolean; basicPropertyValues?: Array<{ pred: string; val: string }> }
}
interface ObographEdge {
  sub: string
  pred: string
  obj: string
}
interface Obographs {
  graphs?: Array<{ meta?: { version?: string }; nodes?: ObographNode[]; edges?: ObographEdge[] }>
}

const HP_IRI = /^(?:http:\/\/purl\.obolibrary\.org\/obo\/HP_|HP:)(\d{7})$/
const ALT_ID = 'http://www.geneontology.org/formats/oboInOwl#hasAlternativeId'
const REPLACED_BY = 'http://purl.obolibrary.org/obo/IAO_0100001'

/** `HP:nnnnnnn` from an HP IRI or CURIE (hp.json uses both). */
function hpId(iri: string): string | null {
  const m = HP_IRI.exec(iri)
  return m === null ? null : `HP:${m[1]}`
}

/** Non-deprecated HPO classes and their is_a edges. */
export function parseHpJson(text: string): HpOntology {
  const graph = (JSON.parse(text) as Obographs).graphs?.[0]
  if (graph?.nodes === undefined) throw new Error('hp.json: no graph nodes')
  const labels = new Map<string, string>()
  const aliases = new Map<string, string>()
  for (const node of graph.nodes) {
    const id = hpId(node.id)
    if (id === null || node.type !== 'CLASS') continue
    const deprecated = node.meta?.deprecated === true
    for (const { pred, val } of node.meta?.basicPropertyValues ?? []) {
      const other = hpId(val)
      if (other === null) continue
      if (!deprecated && pred === ALT_ID) aliases.set(other, id)
      if (deprecated && pred === REPLACED_BY) aliases.set(id, other)
    }
    if (!deprecated) labels.set(id, node.lbl ?? id)
  }
  // Follow replaced_by / alt_id chains to a current term; drop dead ends and cycles.
  const resolved = new Map<string, string>()
  for (const alias of aliases.keys()) {
    const seen = new Set<string>()
    let term: string | undefined = alias
    while (term !== undefined && !labels.has(term) && !seen.has(term)) {
      seen.add(term)
      term = aliases.get(term)
    }
    if (term !== undefined && labels.has(term) && !labels.has(alias)) resolved.set(alias, term)
  }
  const parents = new Map<string, string[]>()
  for (const edge of graph.edges ?? []) {
    if (edge.pred !== 'is_a') continue
    const sub = hpId(edge.sub)
    const obj = hpId(edge.obj)
    if (sub === null || obj === null || !labels.has(sub) || !labels.has(obj)) continue
    const list = parents.get(sub)
    if (list === undefined) parents.set(sub, [obj])
    else list.push(obj)
  }
  const version = /releases\/(\d{4}-\d{2}-\d{2})\//.exec(graph.meta?.version ?? '')?.[1] ?? null
  return { version, labels, parents, aliases: resolved }
}

/** term → all is_a ancestors including itself; an alias maps to its term's ancestors. */
export function ancestorClosure(ontology: HpOntology): Map<string, string[]> {
  const closure = new Map<string, Set<string>>()
  const visit = (term: string, stack: Set<string>): Set<string> => {
    const done = closure.get(term)
    if (done !== undefined) return done
    if (stack.has(term)) throw new Error(`hp.json: is_a cycle at ${term}`)
    stack.add(term)
    const own = new Set([term])
    for (const parent of ontology.parents.get(term) ?? []) {
      for (const anc of visit(parent, stack)) own.add(anc)
    }
    stack.delete(term)
    closure.set(term, own)
    return own
  }
  for (const term of ontology.labels.keys()) visit(term, new Set())
  const result = new Map([...closure].map(([term, set]) => [term, [...set]]))
  for (const [alias, term] of ontology.aliases) result.set(alias, result.get(term) ?? [term])
  return result
}

/**
 * {@link ancestorClosure} restricted to the Phenotypic abnormality subtree:
 * terms outside it (inheritance, onset, modifiers, frequency) are absent, and
 * ancestor lists stop at its root, so they never enter IC or similarity.
 */
export function phenotypeClosure(ontology: HpOntology): Map<string, string[]> {
  const closure = ancestorClosure(ontology)
  const inSubtree = (term: string): boolean =>
    closure.get(term)?.includes(HPO_DATA_CONFIG.phenotypeRoot) === true
  const result = new Map<string, string[]>()
  for (const [term, list] of closure) {
    if (inSubtree(term)) result.set(term, list.filter(inSubtree))
  }
  return result
}

/** Rows of a tab-separated file with a header line; `#` lines are comments. */
function* tsvRows(text: string, required: readonly string[]): Generator<Record<string, string>> {
  let cols: string[] | null = null
  for (const line of text.split(/\r?\n/)) {
    if (line === '' || line.startsWith('#')) continue
    const fields = line.split('\t')
    if (cols === null) {
      cols = fields
      const missing = required.filter((c) => !fields.includes(c))
      if (missing.length > 0) throw new Error(`Missing columns: ${missing.join(', ')}`)
      continue
    }
    const row: Record<string, string> = {}
    cols.forEach((c, i) => (row[c] = fields[i] ?? ''))
    yield row
  }
  if (cols === null) throw new Error('No header line')
}

/** `0/n`, `0%` or the HPO "Excluded" frequency: the phenotype was observed absent. */
function isAbsent(frequency: string): boolean {
  return (
    /^0+\/\d+$/.test(frequency) ||
    /^0+(\.0+)?%$/.test(frequency) ||
    frequency === HPO_DATA_CONFIG.excludedFrequency
  )
}

/**
 * phenotype.hpoa: disease → its positive phenotype (aspect P) terms. NOT and
 * zero-frequency / excluded rows are skipped: they record absent phenotypes.
 */
export function parseHpoaDiseaseTerms(text: string): Map<string, Set<string>> {
  const diseases = new Map<string, Set<string>>()
  const cols = ['database_id', 'qualifier', 'hpo_id', 'aspect', 'frequency']
  for (const row of tsvRows(text, cols)) {
    if (row.aspect !== 'P' || row.qualifier === 'NOT' || isAbsent(row.frequency)) continue
    let set = diseases.get(row.database_id)
    if (set === undefined) diseases.set(row.database_id, (set = new Set()))
    set.add(row.hpo_id)
  }
  return diseases
}

/**
 * genes_to_phenotype.txt: gene symbol → its distinct HPO terms. The file has
 * no qualifier column, so a row counts only when its disease positively
 * supports the term in phenotype.hpoa (`positive`, from parseHpoaDiseaseTerms).
 */
export function parseGenesToPhenotype(
  text: string,
  positive: Map<string, Set<string>>
): Map<string, Set<string>> {
  const genes = new Map<string, Set<string>>()
  for (const row of tsvRows(text, ['gene_symbol', 'hpo_id', 'disease_id'])) {
    if (row.gene_symbol === '' || positive.get(row.disease_id)?.has(row.hpo_id) !== true) continue
    let set = genes.get(row.gene_symbol)
    if (set === undefined) genes.set(row.gene_symbol, (set = new Set()))
    set.add(row.hpo_id)
  }
  return genes
}

/**
 * Annotation-based IC over the disease corpus: IC(t) = -ln(n(t) / N), where
 * n(t) counts diseases annotated to t or any descendant (annotations
 * propagate to all ancestors) and N counts diseases with ≥1 known term.
 * Terms no disease reaches are omitted (IC 0 at lookup); that value is never
 * read, because a MICA is a common ancestor of a gene term and every gene term
 * is positively annotated, so n(MICA) ≥ 1 (no smoothing needed).
 */
export function informationContent(
  diseaseTerms: Map<string, Set<string>>,
  ancestors: Map<string, string[]>
): Map<string, number> {
  const counts = new Map<string, number>()
  let total = 0
  for (const terms of diseaseTerms.values()) {
    const reached = new Set<string>()
    for (const term of terms) for (const anc of ancestors.get(term) ?? []) reached.add(anc)
    if (reached.size === 0) continue
    total++
    for (const anc of reached) counts.set(anc, (counts.get(anc) ?? 0) + 1)
  }
  return new Map([...counts].map(([term, n]) => [term, -Math.log(n / total)]))
}
