/**
 * Case-level metrics and locus-clustered bootstrap intervals shared by the CNV and STR benchmarks.
 */
import { clusterBootstrap, pairedClusterBootstrap, type Interval } from '../stats/bootstrap'
import { mean, tieAveragedHit, tieAveragedReciprocal } from '../stats/metrics'

export const BOOTSTRAP_SEED = 20261017
export const METRICS = ['h1', 'h5', 'h10', 'mrr'] as const
export type Metric = (typeof METRICS)[number]

export interface Standing {
  higher: number
  equal: number
}

/** One case: its cluster and per-arm metrics (already averaged over its backgrounds). */
export interface CaseMetrics {
  cluster: string
  arms: Record<string, Record<Metric, number>>
}

export function metricsOf(s: Standing): Record<Metric, number> {
  return {
    h1: tieAveragedHit(s.higher, s.equal, 1),
    h5: tieAveragedHit(s.higher, s.equal, 5),
    h10: tieAveragedHit(s.higher, s.equal, 10),
    mrr: tieAveragedReciprocal(s.higher, s.equal)
  }
}

/** Mean of each arm's metrics over the standings of one case (one per background). */
export function caseMetrics(
  cluster: string,
  standings: ReadonlyArray<Record<string, Standing>>
): CaseMetrics {
  const arms: CaseMetrics['arms'] = {}
  for (const arm of Object.keys(standings[0] ?? {})) {
    const per = standings.map((s) => metricsOf(s[arm]))
    arms[arm] = Object.fromEntries(METRICS.map((m) => [m, mean(per.map((p) => p[m]))])) as Record<
      Metric,
      number
    >
  }
  return { cluster, arms }
}

const stat =
  (arm: string, m: Metric) =>
  (cs: CaseMetrics[]): number =>
    mean(cs.map((c) => c.arms[arm][m]))

export function armInterval(cases: CaseMetrics[], arm: string, m: Metric): Interval {
  return clusterBootstrap(cases, (c) => c.cluster, stat(arm, m), undefined, BOOTSTRAP_SEED)
}

/** Paired a − b over the same resampled clusters. */
export function pairedDelta(cases: CaseMetrics[], a: string, b: string, m: Metric): Interval {
  const as = cases.map((c) => ({ cluster: c.cluster, v: c.arms[a][m] }))
  const bs = cases.map((c) => ({ cluster: c.cluster, v: c.arms[b][m] }))
  return pairedClusterBootstrap(
    as,
    bs,
    (x) => x.cluster,
    (xs) => mean(xs.map((x) => x.v)),
    undefined,
    BOOTSTRAP_SEED
  )
}

const pct = (x: number): string => (100 * x).toFixed(1)
export const fmt = (i: Interval): string => `${pct(i.estimate)} [${pct(i.lo)}, ${pct(i.hi)}]`

/** Markdown table: one row per arm, Hit@1/5/10 and MRR (%), 95 % cluster-bootstrap CIs. */
export function armTable(cases: CaseMetrics[], arms: readonly string[]): string {
  const rows = arms.map(
    (arm) => `| ${arm} | ${METRICS.map((m) => fmt(armInterval(cases, arm, m))).join(' | ')} |`
  )
  const clusters = new Set(cases.map((c) => c.cluster)).size
  return [
    `n = ${cases.length} cases, ${clusters} clusters.`,
    '',
    '| Arm | Hit@1 | Hit@5 | Hit@10 | MRR (×100) |',
    '|---|---|---|---|---|',
    ...rows
  ].join('\n')
}
