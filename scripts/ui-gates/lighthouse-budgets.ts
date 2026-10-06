/**
 * Lighthouse budgets for the UI quality gate (audit 2026-10-06 §9, standards
 * research A4 P3/P9-P11). Pure functions: they take Lighthouse flow results
 * (one per repeated run) and return a verdict per check, using the median
 * across runs so a single noisy run cannot flip the gate.
 *
 * Budgets are deliberately absolute. Do not relax a threshold to get green —
 * a defect already owned by another track goes in the known-failures map
 * (reported as XFAIL, and XPASS fails the gate so the entry gets removed).
 */

export type GatherMode = 'navigation' | 'timespan' | 'snapshot'
export type BudgetOp = '>=' | '<='
export type CheckStatus = 'pass' | 'fail' | 'xfail' | 'xpass' | 'missing'

export interface BudgetCheck {
  metric: string
  source: { kind: 'category'; id: string } | { kind: 'audit'; id: string }
  op: BudgetOp
  threshold: number
}

/** Desktop budgets, gating. Mobile runs are recorded only (not gated) for now. */
export const DESKTOP_BUDGETS: Readonly<Record<GatherMode, readonly BudgetCheck[]>> = {
  navigation: [
    {
      metric: 'performance',
      source: { kind: 'category', id: 'performance' },
      op: '>=',
      threshold: 0.95
    },
    {
      metric: 'accessibility',
      source: { kind: 'category', id: 'accessibility' },
      op: '>=',
      threshold: 1
    },
    {
      metric: 'best-practices',
      source: { kind: 'category', id: 'best-practices' },
      op: '>=',
      threshold: 1
    },
    {
      metric: 'cls',
      source: { kind: 'audit', id: 'cumulative-layout-shift' },
      op: '<=',
      threshold: 0.02
    }
  ],
  timespan: [
    {
      metric: 'cls',
      source: { kind: 'audit', id: 'cumulative-layout-shift' },
      op: '<=',
      threshold: 0.02
    }
  ],
  snapshot: [
    {
      metric: 'accessibility',
      source: { kind: 'category', id: 'accessibility' },
      op: '>=',
      threshold: 1
    },
    {
      metric: 'best-practices',
      source: { kind: 'category', id: 'best-practices' },
      op: '>=',
      threshold: 1
    }
  ]
}

/** Metrics recorded for every step (gated or not) in the JSON summary. */
export const RECORDED_AUDITS = [
  'first-contentful-paint',
  'largest-contentful-paint',
  'total-blocking-time',
  'cumulative-layout-shift',
  'interaction-to-next-paint',
  'speed-index'
] as const

/** Minimal slice of a Lighthouse result this module reads. */
export interface LhrLike {
  gatherMode: GatherMode
  categories: Record<string, { score: number | null } | undefined>
  audits: Record<string, { numericValue?: number; score?: number | null } | undefined>
}

export interface FlowStepLike {
  name: string
  lhr: LhrLike
}

export interface CheckResult {
  key: string
  step: string
  metric: string
  op: BudgetOp
  threshold: number
  values: number[]
  median: number | null
  status: CheckStatus
  note?: string
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function readCheckValue(lhr: LhrLike, check: BudgetCheck): number | null {
  if (check.source.kind === 'category') {
    return lhr.categories[check.source.id]?.score ?? null
  }
  return lhr.audits[check.source.id]?.numericValue ?? null
}

function meets(value: number, op: BudgetOp, threshold: number): boolean {
  // Scores are reported with float noise (0.9500000001); compare at 4 dp.
  const rounded = Math.round(value * 10_000) / 10_000
  return op === '>=' ? rounded >= threshold : rounded <= threshold
}

/**
 * Evaluate every budgeted check for every step across repeated runs.
 * `runs[i]` is the ordered step list of run i; steps are matched by name.
 */
export function evaluateBudgets(
  runs: readonly (readonly FlowStepLike[])[],
  budgets: Readonly<Record<GatherMode, readonly BudgetCheck[]>>,
  knownFailures: Readonly<Record<string, string>>
): CheckResult[] {
  const first = runs[0] ?? []
  const results: CheckResult[] = []
  for (const step of first) {
    for (const check of budgets[step.lhr.gatherMode]) {
      const values = runs
        .map((run) => run.find((candidate) => candidate.name === step.name))
        .map((match) => (match === undefined ? null : readCheckValue(match.lhr, check)))
        .filter((value): value is number => value !== null)
      const key = `lighthouse:${step.name}:${check.metric}`
      const value = median(values)
      const expected = knownFailures[key]
      let status: CheckStatus
      if (value === null) status = 'missing'
      else if (meets(value, check.op, check.threshold)) status = expected ? 'xpass' : 'pass'
      else status = expected ? 'xfail' : 'fail'
      results.push({
        key,
        step: step.name,
        metric: check.metric,
        op: check.op,
        threshold: check.threshold,
        values,
        median: value,
        status,
        ...(expected ? { note: expected } : {})
      })
    }
  }
  return results
}

export function gateFailures(results: readonly CheckResult[]): CheckResult[] {
  return results.filter(
    (r) => r.status === 'fail' || r.status === 'xpass' || r.status === 'missing'
  )
}

export function recordStepMetrics(step: FlowStepLike): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  for (const id of ['performance', 'accessibility', 'best-practices', 'seo']) {
    out[id] = step.lhr.categories[id]?.score ?? null
  }
  for (const id of RECORDED_AUDITS) {
    out[id] = step.lhr.audits[id]?.numericValue ?? null
  }
  return out
}

export function formatResultTable(results: readonly CheckResult[]): string {
  const lines = ['| check | median | budget | runs | status |', '|---|---|---|---|---|']
  for (const r of results) {
    const fmt = (v: number): string => (r.metric === 'cls' ? v.toFixed(3) : v.toFixed(2))
    lines.push(
      `| ${r.step} ${r.metric} | ${r.median === null ? '—' : fmt(r.median)} | ${r.op} ${r.threshold} | ${r.values.map(fmt).join(', ')} | ${r.status.toUpperCase()}${r.note ? ` (${r.note})` : ''} |`
    )
  }
  return lines.join('\n')
}
