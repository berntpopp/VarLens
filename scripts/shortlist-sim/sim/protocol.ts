/** Protocol helpers: canonical JSON identity, fold tuning, the phenotype-enrichment gene set. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { compileRuleset } from '../../../src/main/services/scoring/evidence'
import type { EvidenceRuleset } from '../../../src/shared/types/evidence-ruleset'
import { fitLogisticPoints } from '../stats/logistic'
import { tuneRuleset, type TuneInput, type TuneResult } from '../stats/tune'
import type { BackgroundInfo } from './background-db'
import type { TemplateId, TunedByTemplate } from './templates'

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

/** One ruleset per test fold and the all-fold refit via L2-regularized joint logistic regression (#640). */
export function tuneLogisticFolds(
  input: TuneInput,
  folds: Map<string, number>,
  k: number,
  disabledGroups: string[],
  opts: { template: EvidenceRuleset; id: string; lambda?: number }
): FoldTuning {
  const perFold = Array.from(
    { length: k },
    (_, f) =>
      fitLogisticPoints(opts.template, input, (g) => folds.get(g) !== f, disabledGroups, {
        id: `${opts.id}-fold${f}`,
        lambda: opts.lambda
      }).ruleset
  )
  const refit = fitLogisticPoints(opts.template, input, () => true, disabledGroups, {
    id: opts.id,
    lambda: opts.lambda
  })
  return { perFold, refit }
}

/** A pre-registered ruleset for a frozen rerun (#584); throws listing every validation problem. */
export function loadFrozenRuleset(file: string): EvidenceRuleset {
  const ruleset = JSON.parse(readFileSync(file, 'utf8')) as EvidenceRuleset
  compileRuleset(ruleset) // the production ruleset validation (rulesetProblems)
  // A registered ruleset carries its own hash (run.ts writes it); an edit after registration breaks it.
  const actual = createHash('sha256').update(canonicalJson(ruleset)).digest('hex')
  if (ruleset.sha256 !== undefined && ruleset.sha256 !== actual)
    throw new Error(`${file}: sha256 ${ruleset.sha256} does not match its content (${actual})`)
  return ruleset
}

/**
 * Fold rulesets per template: a frozen ruleset unchanged in every fold (`tune` never runs), or
 * the result of `tune` (Phase A assignment + fold tuning).
 */
export async function foldRulesets(
  frozen: EvidenceRuleset | undefined,
  template: TemplateId,
  k: number,
  tune: () => Promise<Record<TemplateId, FoldTuning>>
): Promise<{ tunedBy: TunedByTemplate; tunings?: Record<TemplateId, FoldTuning> }> {
  if (frozen !== undefined)
    return { tunedBy: { [template]: Array<EvidenceRuleset>(k).fill(frozen) } }
  const tunings = await tune()
  const tunedBy = Object.fromEntries(
    Object.entries(tunings).map(([tid, t]) => [tid, t.perFold])
  ) as TunedByTemplate
  return { tunedBy, tunings }
}

/** Genes in the background's top decile of `hpo_sim_score` (> 0), for `pheno_enriched`. */
export function phenoEnrichedGenes(bg: BackgroundInfo): Set<string> {
  const scored = [...bg.geneFields.entries()]
    .filter(([, f]) => f.hpo_sim_score !== null && f.hpo_sim_score > 0)
    .sort((a, b) => b[1].hpo_sim_score! - a[1].hpo_sim_score!)
  const n = Math.max(1, Math.ceil(bg.geneFields.size / 10))
  return new Set(scored.slice(0, n).map(([g]) => g))
}
