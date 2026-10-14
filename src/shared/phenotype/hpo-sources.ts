/**
 * Parsers for the HPO release files behind `hpo_resnik` (#600): hp.json
 * (obographs), phenotype.hpoa and genes_to_phenotype.txt, plus the derived
 * ancestor closure and annotation-based information content. Pure.
 */
import { HPO_DATA_CONFIG } from '../config/hpo-data.config'
import { HPO_SCORING_CONFIG } from '../config/hpo-scoring.config'
import { betaQuantile } from './beta-quantile'

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

/** Smoothed frequency of a positive annotation and its conservative lower bound for exclusions. */
export interface HpoaFrequency {
  f: number
  fExcl: number
}

export interface HpoaDiseases {
  labels: Map<string, string>
  /** disease → positive phenotype (aspect P) term → frequency */
  terms: Map<string, Map<string, HpoaFrequency>>
  /** disease → terms it is annotated as lacking (NOT, 0 %, "Excluded", pooled 0/n) */
  not: Map<string, Set<string>>
}

interface PairEvidence {
  m: number
  n: number
  /** max over frequency-term, percentage and missing rows */
  other: HpoaFrequency | null
  absent: boolean
}

const { fractionPrior, exclusionQuantile, frequencyTerms, missing } = HPO_SCORING_CONFIG

/** Smoothed f and Beta lower quantile for pooled m/n (m > 0), memoised: few distinct pairs. */
const fractionCache = new Map<string, HpoaFrequency>()
export function fractionFrequency(m: number, n: number): HpoaFrequency {
  const key = `${m}/${n}`
  let hit = fractionCache.get(key)
  if (hit === undefined) {
    const a = m + fractionPrior.a
    const b = n - m + fractionPrior.b
    hit = { f: a / (a + b), fExcl: betaQuantile(exclusionQuantile, a, b) }
    fractionCache.set(key, hit)
  }
  return hit
}

/** f / f_excl of a non-fraction frequency cell; `absent` for 0 % / "Excluded", null when unparseable. */
function otherFrequency(frequency: string): HpoaFrequency | null | 'absent' {
  if (frequency === '' || frequency === '-') return missing
  const term = frequencyTerms[frequency]
  if (term !== undefined) return term
  if (frequency === HPO_DATA_CONFIG.excludedFrequency) return 'absent'
  const pct = /^(\d+(?:\.\d+)?)%$/.exec(frequency)
  if (pct !== null) {
    const f = Math.min(1, Number(pct[1]) / 100)
    return f > 0 ? { f, fExcl: f } : 'absent'
  }
  return null
}

/**
 * phenotype.hpoa, aspect P rows: per (disease, term) the smoothed frequency
 * (spec §3). Fractions are pooled over rows (Σm, Σn) and win over coarser
 * cells; otherwise the highest frequency-term / percentage / missing value
 * counts. A pair with no positive evidence (NOT, 0 %, "Excluded", pooled 0/n)
 * is a NOT annotation instead. Unknown frequency formats count as missing.
 * Terms are mapped through `aliases` (alt id → current term) before pooling,
 * and a row repeating another's evidence (all columns but disease_name and
 * biocuration equal) counts once.
 */
export function parseHpoaDiseases(
  text: string,
  aliases: ReadonlyMap<string, string> = new Map()
): HpoaDiseases {
  const labels = new Map<string, string>()
  const pairs = new Map<string, Map<string, PairEvidence>>()
  const seen = new Set<string>()
  const cols = ['database_id', 'disease_name', 'qualifier', 'hpo_id', 'aspect', 'frequency']
  for (const row of tsvRows(text, cols)) {
    if (row.aspect !== 'P') continue
    const term = aliases.get(row.hpo_id) ?? row.hpo_id
    const evidenceKey = [
      row.database_id,
      row.qualifier,
      term,
      row.reference,
      row.evidence,
      row.onset,
      row.frequency,
      row.sex,
      row.modifier
    ].join('\t')
    if (seen.has(evidenceKey)) continue
    seen.add(evidenceKey)
    if (!labels.has(row.database_id)) labels.set(row.database_id, row.disease_name)
    let byTerm = pairs.get(row.database_id)
    if (byTerm === undefined) pairs.set(row.database_id, (byTerm = new Map()))
    let ev = byTerm.get(term)
    if (ev === undefined) byTerm.set(term, (ev = { m: 0, n: 0, other: null, absent: false }))
    const fraction = /^(\d+)\/(\d+)$/.exec(row.frequency)
    if (row.qualifier === 'NOT') ev.absent = true
    else if (fraction !== null && Number(fraction[2]) > 0) {
      ev.m += Math.min(Number(fraction[1]), Number(fraction[2]))
      ev.n += Number(fraction[2])
    } else {
      const other = otherFrequency(row.frequency) ?? missing
      if (other === 'absent') ev.absent = true
      else if (ev.other === null || other.f > ev.other.f) ev.other = other
    }
  }
  const terms = new Map<string, Map<string, HpoaFrequency>>()
  const not = new Map<string, Set<string>>()
  for (const [disease, byTerm] of pairs) {
    for (const [term, ev] of byTerm) {
      const freq = ev.m > 0 ? fractionFrequency(ev.m, ev.n) : ev.other
      if (freq !== null) {
        let map = terms.get(disease)
        if (map === undefined) terms.set(disease, (map = new Map()))
        map.set(term, freq)
      } else if (ev.absent || ev.n > 0) {
        let set = not.get(disease)
        if (set === undefined) not.set(disease, (set = new Set()))
        set.add(term)
      }
    }
  }
  return { labels, terms, not }
}

/** phenotype.hpoa: disease → its positive phenotype (aspect P) terms. */
export function parseHpoaDiseaseTerms(text: string): Map<string, Set<string>> {
  const { terms } = parseHpoaDiseases(text)
  return new Map([...terms].map(([disease, map]) => [disease, new Set(map.keys())]))
}

/**
 * genes_to_phenotype.txt: gene symbol → its distinct HPO terms (the
 * simulation harness's exact-overlap baseline). The file has no qualifier
 * column, so a row counts only when its disease positively supports the term
 * in phenotype.hpoa (`positive`, from parseHpoaDiseaseTerms).
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
 * genes_to_phenotype.txt: gene symbol → its diseases. Only diseases with a
 * positive phenotype annotation in phenotype.hpoa (`positive`) count.
 */
export function parseGeneDiseases(
  text: string,
  positive: ReadonlyMap<string, unknown>
): Map<string, Set<string>> {
  const genes = new Map<string, Set<string>>()
  for (const row of tsvRows(text, ['gene_symbol', 'disease_id'])) {
    if (row.gene_symbol === '' || !positive.has(row.disease_id)) continue
    let set = genes.get(row.gene_symbol)
    if (set === undefined) genes.set(row.gene_symbol, (set = new Set()))
    set.add(row.disease_id)
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
