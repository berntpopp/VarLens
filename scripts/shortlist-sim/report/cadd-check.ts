// CADD fidelity check: spike CADD provenance and the primary endpoint on SNV-only cases, where
// every causal allele has a real CADD API value (no imputation).
import type { CaseResult, RunManifest } from '../common/types'
import { clusterBootstrap, pairedClusterBootstrap } from '../stats/bootstrap'
import { caseHit, macroAverage } from '../stats/metrics'
import { ci, dpts } from './markdown'

const SCORERS = ['tier1', 'cadd_desc', 'evidence_tuned'] as const

export function caddCheckSection(
  results: CaseResult[],
  m: RunManifest,
  reps: number,
  seed: number
): string {
  const extra = m as RunManifest & { caddImpute?: boolean; caddSources?: Record<string, number> }
  const pick = (scorer: string): CaseResult[] =>
    results.filter((r) => r.scorer === scorer && r.scenario === 'primary' && r.snvOnly === true)
  const hit10 = (cs: CaseResult[]): number => macroAverage(cs, caseHit(10))
  const rows = SCORERS.map((s) => {
    const cs = pick(s)
    return `| ${s} | ${cs.length} | ${cs.length ? ci(clusterBootstrap(cs, (c) => c.gene, hit10, reps, seed)) : '–'} |`
  })
  const cand = pick('evidence_tuned')
  const ref = pick('tier1')
  const delta =
    cand.length && ref.length
      ? pairedClusterBootstrap(cand, ref, (c) => c.gene, hit10, reps, seed)
      : undefined
  const sources = Object.entries(extra.caddSources ?? {})
    .map(([k, v]) => `${k} ${v}`)
    .join(', ')
  return [
    '## CADD fidelity check',
    `Spike CADD: SNVs from the CADD v1.7 API; indels (and SNVs without a precomputed score) ${extra.caddImpute === false ? '**not imputed** (missing CADD kept)' : 'imputed from background rows with the same varvis func and allele class, missing values included'}. Spike rows by CADD source: ${sources || '–'}. Threat: imputed CADD is not the variant’s own score, and the varvis CADD version is unknown (see the concordance checks).`,
    'Primary scenario, SNV-only cases (every causal allele has its real CADD), all modes:',
    ['| Scorer | Cases | Hit@10 [95 % CI] |', '| --- | --- | --- |', ...rows].join('\n'),
    `ΔHit@10 evidence_tuned − tier1 on SNV-only cases: ${dpts(delta)}.`
  ].join('\n\n')
}
