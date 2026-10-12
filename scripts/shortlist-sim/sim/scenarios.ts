/**
 * Simulation scenarios (spec §4.6). Every scenario except `clinvar_visible` masks ClinVar on
 * all rows; the phenotype and missingness scenarios change one more factor on top of that.
 */
import type { ScenarioId } from '../common/types'
import type { MappedVariant } from '../concordance/load-backgrounds'
import { shuffle } from '../common/rng'

export type { ScenarioId }

export const SCENARIOS: readonly ScenarioId[] = [
  'primary',
  'clinvar_visible',
  'pheno_free',
  'pheno_shuffled',
  'missingness',
  'pheno_enriched'
]

export const masksClinvar = (s: ScenarioId): boolean => s !== 'clinvar_visible'

/** Background rows under a scenario (copies; the input is not modified). */
export function applyScenarioToBackground(
  rows: readonly MappedVariant[],
  s: ScenarioId,
  rnd: () => number
): MappedVariant[] {
  const out = rows.map((r) => ({ ...r }))
  for (const r of out) {
    if (masksClinvar(s)) r.clinvar = null
    if (s === 'pheno_free') r.hpo_sim_score = null
  }
  if (s === 'pheno_shuffled') shuffleGenePhenotype(out, rnd)
  return out
}

/** Permute the gene-level `hpo_sim_score` across genes (multiset kept, constant within a gene). */
function shuffleGenePhenotype(rows: MappedVariant[], rnd: () => number): void {
  const byGene = new Map<string, number | null>()
  for (const r of rows) {
    if (r.gene_symbol !== null && !byGene.has(r.gene_symbol))
      byGene.set(r.gene_symbol, r.hpo_sim_score)
  }
  const genes = [...byGene.keys()].sort()
  const permuted = shuffle(
    genes.map((g) => byGene.get(g) ?? null),
    rnd
  )
  const assigned = new Map(genes.map((g, i) => [g, permuted[i]]))
  for (const r of rows) {
    if (r.gene_symbol !== null) r.hpo_sim_score = assigned.get(r.gene_symbol) ?? null
  }
}

/** Gene-level fields of a background gene after the scenario. */
export interface GeneFields {
  omim_mim_number: string | null
  moi: string | null
  hpo_sim_score: number | null
}

/** What `applyScenarioToSpike` needs from the background (post-scenario). */
export interface SpikeScenarioContext {
  geneFields: Map<string, GeneFields>
  /** Per varvis `func`: observed [gnomad_af missing, cadd missing] patterns of background rows. */
  missingByFunc: Map<string, Array<[boolean, boolean]>>
}

/**
 * A spike row under a scenario: ClinVar masked, gene fields from the (scenario-applied)
 * background, and for `missingness` the joint AF/CADD missingness pattern of a random
 * background row with the same `func`.
 */
export function applyScenarioToSpike(
  row: MappedVariant,
  s: ScenarioId,
  bg: SpikeScenarioContext,
  rnd: () => number
): MappedVariant {
  const out = { ...row }
  if (masksClinvar(s)) out.clinvar = null
  const gene = out.gene_symbol === null ? undefined : bg.geneFields.get(out.gene_symbol)
  if (gene !== undefined) Object.assign(out, gene)
  if (s === 'missingness' && out.func !== null) {
    const patterns = bg.missingByFunc.get(out.func)
    if (patterns !== undefined && patterns.length > 0) {
      const [afMissing, caddMissing] = patterns[Math.floor(rnd() * patterns.length)]
      if (afMissing) out.gnomad_af = null
      if (caddMissing) out.cadd = null
    }
  }
  return out
}
