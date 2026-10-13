/**
 * Simulation jobs, executed in worker threads (or in-process with --workers 1). A job is one
 * background × scenario × slice of cases; the runner keeps the last background DB open.
 */
import { compileRuleset } from '../../../src/main/services/scoring/evidence'
import { isReferenceRule } from '../../../src/shared/evidence/ruleset-problems'
import type { ModeId } from '../../../src/shared/types/evidence-ruleset'
import type { ShortlistRow } from '../../../src/shared/types/shortlist'
import type { CaseResult, ScenarioId } from '../common/types'
import { rng } from '../common/rng'
import type { Background } from '../concordance/load-backgrounds'
import type { Assignment } from '../stats/tune'
import { openBackgroundDb, type BackgroundDb } from './background-db'
import type { SimCase } from './cases'
import { rankAll, runCase, withSpikes } from './run-case'
import { buildScorers, evidenceConfig } from './scorers'
import { TEMPLATES, type TemplateId, type TunedByTemplate } from './templates'

export interface WorkerInit {
  backgrounds: Background[]
  seed: number
  disabledGroups: string[]
  /** Template whose rulesets are the evidence_* scorers. */
  template: TemplateId
}

type PerTemplate<T> = Partial<Record<TemplateId, T>>

export type Job =
  | {
      kind: 'assign'
      bg: string
      scenario: ScenarioId
      cases: SimCase[]
      withBackground: boolean
      templates: TemplateId[]
    }
  | {
      kind: 'eval'
      bg: string
      scenario: ScenarioId
      cases: SimCase[]
      folds: number[]
      tuned: TunedByTemplate
    }

export type JobResult =
  | {
      kind: 'assign'
      positives: PerTemplate<Assignment[]>
      background: PerTemplate<Assignment[]>
      overlaps: PerTemplate<Record<string, number>>
    }
  | { kind: 'eval'; results: CaseResult[] }

/** Deterministic per-case stream, independent of job slicing and worker count. */
export function caseRng(seed: number, caseId: string, scenario: string): () => number {
  let h = seed >>> 0
  for (const ch of `${caseId}|${scenario}`) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0
  return rng(h)
}

function assignmentOf(row: ShortlistRow, scenario: ScenarioId): Assignment {
  const bins: Record<string, string> = {}
  for (const c of row.rank_evidence ?? [])
    if (c.kind === 'rule' && c.group !== null) bins[c.group] = c.id
  return { gene: row.gene_symbol ?? '', mode: row.rank_mode as ModeId, bins, scenario }
}

// First-match assignments do not depend on points: the template's own points are fine.
const assignConfig = (t: TemplateId) => evidenceConfig(TEMPLATES[t])

/** Rows matching more than one non-reference bin of a group (bins must be exclusive). */
function countOverlaps(t: TemplateId, rows: readonly ShortlistRow[]): Record<string, number> {
  const compiled = compileRuleset(TEMPLATES[t])
  const out: Record<string, number> = {}
  for (const row of rows) {
    const view = row as unknown as Record<string, unknown>
    for (const g of compiled.groups) {
      const n = g.rules.filter((r) => !isReferenceRule(r) && r.test(view)).length
      if (n > 1) out[g.id] = (out[g.id] ?? 0) + 1
    }
  }
  return out
}

export class JobRunner {
  private current: BackgroundDb | null = null

  constructor(private readonly init: WorkerInit) {}

  private open(label: string, scenario: ScenarioId): BackgroundDb {
    if (this.current?.label === label && this.current.scenario === scenario) return this.current
    this.current?.db.close()
    const bg = this.init.backgrounds.find((b) => b.caseLabel === label)
    if (bg === undefined) throw new Error(`unknown background ${label}`)
    this.current = openBackgroundDb(bg, scenario, this.init.seed)
    return this.current
  }

  run(job: Job): JobResult {
    const bg = this.open(job.bg, job.scenario)
    return job.kind === 'assign' ? this.assign(bg, job) : this.evaluate(bg, job)
  }

  private assign(bg: BackgroundDb, job: Extract<Job, { kind: 'assign' }>): JobResult {
    const positives: PerTemplate<Assignment[]> = {}
    for (const t of job.templates) positives[t] = []
    for (const c of job.cases) {
      withSpikes(bg, c, caseRng(this.init.seed, c.id, job.scenario), (ids) => {
        for (const t of job.templates) {
          const { rows } = rankAll(bg, assignConfig(t))
          for (const id of ids.causal) {
            const row = rows.find((r) => r.id === id)
            if (row !== undefined) positives[t]!.push(assignmentOf(row, job.scenario))
          }
        }
      })
    }
    const background: PerTemplate<Assignment[]> = {}
    const overlaps: PerTemplate<Record<string, number>> = {}
    if (job.withBackground) {
      for (const t of job.templates) {
        const { rows } = rankAll(bg, assignConfig(t))
        background[t] = rows.map((r) => assignmentOf(r, job.scenario))
        overlaps[t] = countOverlaps(t, rows)
      }
    }
    return { kind: 'assign', positives, background, overlaps }
  }

  private evaluate(bg: BackgroundDb, job: Extract<Job, { kind: 'eval' }>): JobResult {
    const scorers = buildScorers(job.tuned, this.init.disabledGroups, this.init.template)
    const results = job.cases.flatMap((c, i) =>
      runCase(bg, c, scorers, job.folds[i], caseRng(this.init.seed, c.id, job.scenario))
    )
    return { kind: 'eval', results }
  }
}
