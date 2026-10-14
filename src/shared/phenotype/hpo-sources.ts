/**
 * Parsers for the HPO release files behind `hpo_resnik` (#600): hp.json
 * (obographs), phenotype.hpoa and genes_to_phenotype.txt, plus the derived
 * ancestor closure and annotation-based information content. Pure.
 */

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
  for (const [alias, term] of aliases) {
    if (labels.has(alias) || !labels.has(term)) aliases.delete(alias)
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
  return { version, labels, parents, aliases }
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

/** phenotype.hpoa: disease → its phenotype (aspect P) terms, NOT-qualified rows skipped. */
export function parseHpoaDiseaseTerms(text: string): Map<string, Set<string>> {
  const diseases = new Map<string, Set<string>>()
  for (const row of tsvRows(text, ['database_id', 'qualifier', 'hpo_id', 'aspect'])) {
    if (row.aspect !== 'P' || row.qualifier === 'NOT') continue
    let set = diseases.get(row.database_id)
    if (set === undefined) diseases.set(row.database_id, (set = new Set()))
    set.add(row.hpo_id)
  }
  return diseases
}

/** genes_to_phenotype.txt: gene symbol → its distinct HPO terms. */
export function parseGenesToPhenotype(text: string): Map<string, Set<string>> {
  const genes = new Map<string, Set<string>>()
  for (const row of tsvRows(text, ['gene_symbol', 'hpo_id'])) {
    if (row.gene_symbol === '' || row.hpo_id === '') continue
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
 * Terms no disease reaches are omitted (IC 0 at lookup).
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
