// Sensitivity analyses of the primary endpoint: macro over well-populated classes only, and
// the CADD-imputation-off rerun. Aggregates only.
import type { CaseResult } from '../common/types'
import { clusterBootstrap, pairedClusterBootstrap } from '../stats/bootstrap'
import { caseHit, macroAverage } from '../stats/metrics'
import { ci, dpts } from './markdown'

export const MIN_CLASS_CASES = 30
const SCORERS = [
  'tier1',
  'all_rare_damaging',
  'cadd_desc',
  'af_asc',
  'evidence_hand',
  'evidence_tuned'
]
const hit10 = (cs: CaseResult[]): number => macroAverage(cs, caseHit(10))
const byGene = (c: CaseResult): string => c.gene

function hitTable(results: CaseResult[], reps: number, seed: number): string {
  const pick = (s: string): CaseResult[] => results.filter((r) => r.scorer === s)
  const ref = pick('tier1')
  const rows = SCORERS.filter((s) => pick(s).length > 0).map((s) => {
    const cs = pick(s)
    const delta =
      s === 'tier1' ? 'reference' : dpts(pairedClusterBootstrap(cs, ref, byGene, hit10, reps, seed))
    return `| ${s} | ${cs.length} | ${ci(clusterBootstrap(cs, byGene, hit10, reps, seed))} | ${delta} |`
  })
  return [
    '| Scorer | Cases | Hit@10 [95 % CI] | ΔHit@10 vs tier1 |',
    '| --- | --- | --- | --- |',
    ...rows
  ].join('\n')
}

/** Primary Hit@10 with classes of fewer than 30 test cases dropped from the macro average. */
export function macroSensitivitySection(results: CaseResult[], reps: number, seed: number): string {
  const primary = results.filter((r) => r.scenario === 'primary')
  const counts = new Map<string, number>()
  for (const r of primary.filter((x) => x.scorer === 'evidence_tuned'))
    counts.set(r.consequenceClass, (counts.get(r.consequenceClass) ?? 0) + 1)
  const kept = [...counts].filter(([, n]) => n >= MIN_CLASS_CASES).map(([c]) => c)
  const dropped = [...counts].filter(([, n]) => n < MIN_CLASS_CASES).map(([c, n]) => `${c} (${n})`)
  return [
    '## Sensitivity: macro over classes with ≥ 30 test cases',
    `The pre-registered primary endpoint averages over all consequence classes; a class with very few cases then carries the same weight as a large one, and its absence from a bootstrap resample shifts the macro (skewed intervals). Here classes with fewer than ${MIN_CLASS_CASES} test cases are dropped, as mode strata are. Kept: ${kept.join(', ') || '–'}; dropped: ${dropped.join(', ') || 'none'}. The ship decision uses the primary endpoint, not this one.`,
    hitTable(
      primary.filter((r) => kept.includes(r.consequenceClass)),
      reps,
      seed
    )
  ].join('\n\n')
}

/** Primary endpoint of the CADD-imputation-off rerun (spike indels keep missing CADD). */
export function caddOffSection(
  results: CaseResult[],
  run: string,
  reps: number,
  seed: number
): string {
  return [
    '## Sensitivity: CADD imputation off',
    `Run \`${run}\`: identical protocol, but spike indels (and SNVs without a CADD API score) keep a missing CADD instead of a value imputed from the background. Primary scenario, all classes:`,
    hitTable(
      results.filter((r) => r.scenario === 'primary'),
      reps,
      seed
    )
  ].join('\n\n')
}

/** Paired full-template − varvis-template comparison on the same cases (#597). */
export function templateComparisonSection(
  results: CaseResult[],
  reps: number,
  seed: number
): string | null {
  if (!results.some((r) => r.scorer === 'varvis_hand')) return null
  const rows: string[] = []
  for (const scenario of ['primary', 'clinvar_visible'] as const) {
    for (const [full, varvis] of [
      ['evidence_hand', 'varvis_hand'],
      ['evidence_tuned', 'varvis_tuned']
    ]) {
      const pick = (s: string): CaseResult[] =>
        results.filter((r) => r.scorer === s && r.scenario === scenario)
      const a = pick(full)
      const b = pick(varvis)
      if (a.length === 0 || b.length === 0) continue
      rows.push(
        `| ${scenario} | ${full} vs ${varvis} | ${ci(clusterBootstrap(a, byGene, hit10, reps, seed))} | ${ci(clusterBootstrap(b, byGene, hit10, reps, seed))} | ${dpts(pairedClusterBootstrap(a, b, byGene, hit10, reps, seed))} |`
      )
    }
  }
  return [
    '## Full template vs varvis template (paired)',
    'Same cases, same folds; `evidence_*` use the full template, `varvis_*` the 18-field varvis template. Hit@10 macro over classes, all modes; Δ = full − varvis, paired gene-cluster bootstrap.',
    [
      '| Scenario | Pair | Full Hit@10 | varvis Hit@10 | Δ |',
      '| --- | --- | --- | --- | --- |',
      ...rows
    ].join('\n')
  ].join('\n\n')
}
