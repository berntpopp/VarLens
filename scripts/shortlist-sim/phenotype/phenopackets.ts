/**
 * GA4GH phenopacket (schema 2.0) reader for the external HPO benchmark (#600): one published,
 * solved case per file with its observed and excluded HPO terms and its diagnosed gene.
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Every `.json` file under `dir`, depth-first. */
export function* jsonFiles(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, e.name)
    if (e.isDirectory()) yield* jsonFiles(path)
    else if (e.name.endsWith('.json')) yield path
  }
}

export interface PhenopacketCase {
  id: string
  /** The single diagnosed gene (HGNC symbol). */
  gene: string
  /** Disease ids of the diagnosis (OMIM/ORPHA/MONDO). */
  diseases: string[]
  /** PMIDs of the source publication(s), `PMID:` prefixed. */
  pmids: string[]
  observed: string[]
  /** Explicitly excluded (`excluded: true`) terms, minus any also reported observed. */
  excluded: string[]
}

type Json = Record<string, unknown>
const obj = (x: unknown): Json => (x !== null && typeof x === 'object' ? (x as Json) : {})
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : [])
const str = (x: unknown): string | null => (typeof x === 'string' && x !== '' ? x : null)
const uniq = (xs: Array<string | null>): string[] => [
  ...new Set(xs.filter((x): x is string => x !== null))
]

/** Gene symbol of one genomic interpretation: a gene descriptor or a variant's gene context. */
function interpretationGene(gi: Json): string | null {
  const variant = obj(obj(gi.variantInterpretation).variationDescriptor)
  return str(obj(gi.gene).symbol) ?? str(obj(variant.geneContext).symbol)
}

/**
 * The case, or null when it is not a single-gene diagnosis (no gene, or several genes as in
 * digenic cases) or has no observed HPO term.
 */
export function parsePhenopacket(json: unknown): PhenopacketCase | null {
  const pp = obj(json)
  const interpretations = arr(pp.interpretations).map(obj)
  const diagnoses = interpretations.map((i) => obj(i.diagnosis))
  const genes = uniq(
    diagnoses.flatMap((d) => arr(d.genomicInterpretations).map((gi) => interpretationGene(obj(gi))))
  )
  const features = arr(pp.phenotypicFeatures).map(obj)
  const term = (f: Json): string | null => {
    const id = str(obj(f.type).id)
    return id?.startsWith('HP:') === true ? id : null
  }
  const observed = uniq(features.filter((f) => f.excluded !== true).map(term))
  const excluded = uniq(features.filter((f) => f.excluded === true).map(term)).filter(
    (t) => !observed.includes(t)
  )
  if (genes.length !== 1 || observed.length === 0) return null
  return {
    id: str(pp.id) ?? '',
    gene: genes[0],
    diseases: uniq([
      ...diagnoses.map((d) => str(obj(d.disease).id)),
      ...arr(pp.diseases).map((d) => str(obj(obj(d).term).id))
    ]),
    pmids: uniq(
      arr(obj(pp.metaData).externalReferences).map((r) => {
        const id = str(obj(r).id)
        return id?.startsWith('PMID:') === true ? id : null
      })
    ),
    observed,
    excluded
  }
}

/** disease id → PMIDs cited in phenotype.hpoa's reference column for that disease. */
export function hpoaReferences(hpoa: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const line of hpoa.split('\n')) {
    if (line.startsWith('#') || line.startsWith('database_id')) continue
    const cols = line.split('\t')
    if (cols.length < 5) continue
    for (const ref of cols[4].split(';')) {
      if (!ref.startsWith('PMID:')) continue
      const refs = out.get(cols[0]) ?? new Set<string>()
      out.set(cols[0], refs.add(ref.trim()))
    }
  }
  return out
}

/**
 * True when a case's publication is cited by HPOA for one of `diseases` (leakage risk): by default
 * the case's own diagnoses (registered); the sensitivity analysis passes every disease of its gene.
 */
export function citedByHpoa(
  c: PhenopacketCase,
  refs: Map<string, Set<string>>,
  diseases: readonly string[] = c.diseases
): boolean {
  return diseases.some((d) => c.pmids.some((p) => refs.get(d)?.has(p) === true))
}
