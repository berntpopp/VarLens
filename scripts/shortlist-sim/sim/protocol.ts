/** Protocol helpers: canonical JSON identity, fold tuning, the phenotype-enrichment gene set. */
import type { EvidenceRuleset } from '../../../src/shared/types/evidence-ruleset'
import { tuneRuleset, type TuneInput, type TuneResult } from '../stats/tune'
import type { BackgroundInfo } from './background-db'

/** Sorted keys, no whitespace, `sha256` field dropped (spec §11.6). */
export function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm)
    if (v !== null && typeof v === 'object') {
      const o = v as Record<string, unknown>
      return Object.fromEntries(
        Object.keys(o)
          .filter((k) => k !== 'sha256')
          .sort()
          .map((k) => [k, norm(o[k])])
      )
    }
    return v
  }
  return JSON.stringify(norm(value))
}

export interface FoldTuning {
  perFold: EvidenceRuleset[]
  refit: TuneResult
}

/** One ruleset per test fold (trained on the other folds) and the all-fold refit. */
export function tuneFolds(
  input: TuneInput,
  folds: Map<string, number>,
  k: number,
  disabledGroups: string[],
  opts: { reps: number; seed: number; template: EvidenceRuleset; id: string }
): FoldTuning {
  const perFold = Array.from(
    { length: k },
    (_, f) =>
      tuneRuleset(opts.template, input, (g) => folds.get(g) !== f, disabledGroups, {
        id: `${opts.id}-fold${f}`
      }).ruleset
  )
  const refit = tuneRuleset(opts.template, input, () => true, disabledGroups, {
    id: opts.id,
    bootstrap: { reps: opts.reps, seed: opts.seed }
  })
  return { perFold, refit }
}

/** Genes in the background's top decile of `hpo_sim_score` (> 0), for `pheno_enriched`. */
export function phenoEnrichedGenes(bg: BackgroundInfo): Set<string> {
  const scored = [...bg.geneFields.entries()]
    .filter(([, f]) => f.hpo_sim_score !== null && f.hpo_sim_score > 0)
    .sort((a, b) => b[1].hpo_sim_score! - a[1].hpo_sim_score!)
  const n = Math.max(1, Math.ceil(bg.geneFields.size / 10))
  return new Set(scored.slice(0, n).map(([g]) => g))
}
