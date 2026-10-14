/**
 * Simulated patient HPO profiles for the hpo_resnik gene-ranking benchmark (#600), in the style
 * of the Phenomizer simulation (Köhler et al. 2009, AJHG): true disease terms, imprecision (a term
 * replaced by an ancestor) and noise (random phenotypic-abnormality terms). Public data only.
 */
import { tsvRows, type HpOntology } from '../../../src/shared/phenotype/hpo-sources'

export const PHENOTYPIC_ABNORMALITY = 'HP:0000118'
/** True terms per profile: the size of a typical clinical HPO profile. */
export const PROFILE_TERMS = 5
/** Weight of an annotation without a frequency: neither favoured nor dropped. */
export const UNKNOWN_FREQUENCY = 0.5

export interface NoiseLevel {
  /** Probability that a true term is replaced by an ancestor. */
  imprecision: number
  /** is_a steps walked up for an imprecise term. */
  steps: number
  /** Random phenotypic-abnormality terms added. */
  noise: number
}

/** Report strata: exact profile / a clinician's usual vagueness / a poor referral note. */
export const NOISE_LEVELS = {
  clean: { imprecision: 0, steps: 0, noise: 0 },
  moderate: { imprecision: 0.4, steps: 1, noise: 2 },
  noisy: { imprecision: 0.6, steps: 2, noise: 5 }
} as const satisfies Record<string, NoiseLevel>
export type NoiseLevelId = keyof typeof NOISE_LEVELS

/** Midpoints of the HPO frequency classes; HP:0040285 (excluded) is never sampled. */
const FREQUENCY_CLASS: Record<string, number> = {
  'HP:0040280': 1,
  'HP:0040281': 0.9,
  'HP:0040282': 0.55,
  'HP:0040283': 0.17,
  'HP:0040284': 0.025,
  'HP:0040285': 0
}

/** phenotype.hpoa `frequency` (HPO class, `n/m` or `x%`) → sampling weight. */
export function frequencyWeight(value: string): number {
  if (value in FREQUENCY_CLASS) return FREQUENCY_CLASS[value]
  const ratio = /^(\d+)\/(\d+)$/.exec(value)
  if (ratio !== null && Number(ratio[2]) > 0) return Number(ratio[1]) / Number(ratio[2])
  const pct = /^([\d.]+)%$/.exec(value)
  if (pct !== null) return Number(pct[1]) / 100
  return UNKNOWN_FREQUENCY
}

export interface Disease {
  id: string
  /** term → sampling weight (> 0). */
  terms: Map<string, number>
  genes: string[]
}

const DISEASE_DB = /^(OMIM|ORPHA):/

/**
 * OMIM and ORPHA diseases with ≥1 positive phenotype term (phenotype.hpoa, aspect P, NOT rows
 * and excluded-frequency rows dropped) and ≥1 gene (genes_to_phenotype.txt), sorted by id.
 */
export function parseDiseases(hpoa: string, genesToPhenotype: string): Disease[] {
  const genes = new Map<string, Set<string>>()
  for (const r of tsvRows(genesToPhenotype, ['disease_id', 'gene_symbol'])) {
    if (!DISEASE_DB.test(r.disease_id) || r.gene_symbol === '') continue
    let set = genes.get(r.disease_id)
    if (set === undefined) genes.set(r.disease_id, (set = new Set()))
    set.add(r.gene_symbol)
  }
  const terms = new Map<string, Map<string, number>>()
  for (const r of tsvRows(hpoa, ['database_id', 'qualifier', 'hpo_id', 'frequency', 'aspect'])) {
    if (r.aspect !== 'P' || r.qualifier === 'NOT' || !genes.has(r.database_id)) continue
    const w = frequencyWeight(r.frequency)
    if (w <= 0) continue
    let map = terms.get(r.database_id)
    if (map === undefined) terms.set(r.database_id, (map = new Map()))
    map.set(r.hpo_id, Math.max(w, map.get(r.hpo_id) ?? 0))
  }
  return [...terms]
    .map(([id, t]) => ({ id, terms: t, genes: [...(genes.get(id) ?? [])].sort() }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export interface ProfileOntology {
  parents: Map<string, string[]>
  /** Strict descendants of HP:0000118, sorted: the noise pool and the imprecision ceiling. */
  abnormalities: string[]
  isAbnormality: Set<string>
}

export function profileOntology(hp: HpOntology, ancestors: Map<string, string[]>): ProfileOntology {
  const abnormalities = [...hp.labels.keys()]
    .filter(
      (t) => t !== PHENOTYPIC_ABNORMALITY && ancestors.get(t)?.includes(PHENOTYPIC_ABNORMALITY)
    )
    .sort()
  return { parents: hp.parents, abnormalities, isAbnormality: new Set(abnormalities) }
}

/** k distinct keys, weighted without replacement (Efraimidis–Spirakis keys). */
export function weightedSample(
  weights: Map<string, number>,
  k: number,
  rnd: () => number
): string[] {
  return [...weights]
    .map(([t, w]) => ({ t, key: -Math.log(1 - rnd()) / w }))
    .sort((a, b) => a.key - b.key)
    .slice(0, k)
    .map((x) => x.t)
}

/** Walks up to `steps` random is_a parents, never to HP:0000118 or outside its subtree. */
export function generalise(
  term: string,
  steps: number,
  ont: ProfileOntology,
  rnd: () => number
): string {
  let t = term
  for (let i = 0; i < steps; i++) {
    const up = (ont.parents.get(t) ?? []).filter((p) => ont.isAbnormality.has(p))
    if (up.length === 0) break
    t = up[Math.floor(rnd() * up.length)]
  }
  return t
}

/**
 * One simulated profile. The random stream is consumed in the same order for every level, so
 * with the same seed all levels share the same true terms (paired strata).
 */
export function generateProfile(
  disease: Disease,
  level: NoiseLevel,
  ont: ProfileOntology,
  rnd: () => number
): string[] {
  const out = weightedSample(disease.terms, PROFILE_TERMS, rnd).map((t) =>
    rnd() < level.imprecision ? generalise(t, level.steps, ont, rnd) : t
  )
  for (let i = 0; i < level.noise; i++) {
    out.push(ont.abnormalities[Math.floor(rnd() * ont.abnormalities.length)])
  }
  return [...new Set(out)]
}

/** Stable 32-bit seed for one disease (FNV-1a of the id, mixed with the run seed). */
export function diseaseSeed(id: string, seed: number): number {
  let h = 0x811c9dc5 ^ seed
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193)
  return h >>> 0
}
