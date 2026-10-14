/**
 * Nested cross-validated tuning of the v2 phenotype scorer (#600): pre-registered greedy
 * coordinate search, training objective, selection and the E1-gain / E2-drop frontier per step.
 * Pure; tune.ts supplies the standings.
 *
 * Objective (pre-registered 2026-10-14, training folds only): maximise mean E1 Hit@10 over the
 * moderate and noisy levels, subject to an E2 Hit@50 drop vs E1 ≤ 2 pp at every level and E0
 * non-inferiority (spec §5 criterion 2). If no setting is feasible: the smallest E2 drop among
 * E0-non-inferior settings (all settings if none is), ties by the higher objective.
 */
import { mean, tieAveragedHit } from '../stats/metrics'
import type { ArmId } from './arms'
import { SHIP, type GeneRankCase, type Standing } from './gene-ranking-report'
import type { NoiseLevelId } from './profiles'

/** Overrides of `HPO_SCORING_CONFIG` fields (the scorer reads its config per call). */
export type Overrides = Record<string, number | string>

export interface TuneStep {
  label: string
  /** Each point is merged over the setting chosen by the previous steps. */
  grid: Overrides[]
}

const cross = (a: Overrides[], b: Overrides[]): Overrides[] =>
  a.flatMap((x) => b.map((y) => ({ ...x, ...y })))
const axis = (key: string, values: ReadonlyArray<number | string>): Overrides[] =>
  values.map((v) => ({ [key]: v }))

/**
 * Pre-registered order and grids (s5 research fixes, coordinator 2026-10-14):
 * C1 IC-weighted forward → A1 per-disease null normalisation → B1 additive error-tolerant
 * exclusion → key weight. Keys are HPO_SCORING_CONFIG field names.
 */
export const TUNING_STEPS: TuneStep[] = [
  { label: 'C1 IC-weighted forward (τ)', grid: axis('icWeightTau', [0, 0.5, 1]) },
  {
    label: 'A1 null normalisation (mode, c)',
    grid: [
      { backgroundCorrection: 'off' },
      ...cross(
        axis('backgroundCorrection', ['unit', 'z']),
        axis('diseaseCountPenalty', [0, 0.5, 1])
      )
    ]
  },
  {
    label: 'B1 error-tolerant exclusion (ε, λ_z)',
    grid: cross(
      axis('exclusionEpsilon', [0.05, 0.1, 0.2, 0.3]),
      axis('exclusionLambdaZ', [0.25, 0.5, 1])
    )
  },
  { label: 'key weight', grid: axis('keyWeight', [1.5, 2, 3]) }
]

/** One case: metadata and the sprint-3 standing. */
export interface TuneCase {
  meta: Pick<GeneRankCase, 'disease' | 'level' | 'arm' | 'fold'>
  baseline: Standing
}

export interface SettingSummary {
  /** Mean E1 Hit@10 over moderate and noisy. */
  objective: number
  /** The same for the sprint-3 baseline. */
  baselineObjective: number
  /** Max over levels of Hit@50(E1) − Hit@50(E2). */
  e2Drop: number
  e0Ok: boolean
  feasible: boolean
}

/**
 * Training summary of one setting: `standings` holds [higher, equal] of case i at 2i, 2i + 1;
 * only the cases in `subset` count.
 */
export function summarize(
  cases: TuneCase[],
  standings: Int32Array,
  subset: readonly number[]
): SettingSummary {
  const hit = (k: number, s: 'v2' | 'baseline', level: NoiseLevelId, arm: ArmId): number =>
    mean(
      subset
        .filter((i) => cases[i].meta.level === level && cases[i].meta.arm === arm)
        .map((i) =>
          s === 'baseline'
            ? tieAveragedHit(cases[i].baseline.higher, cases[i].baseline.equal, k)
            : tieAveragedHit(standings[2 * i], standings[2 * i + 1], k)
        )
    )
  const objectiveOf = (s: 'v2' | 'baseline'): number =>
    (hit(10, s, 'moderate', 'E1') + hit(10, s, 'noisy', 'E1')) / 2
  const levels: NoiseLevelId[] = ['clean', 'moderate', 'noisy']
  const e2Drop = Math.max(...levels.map((l) => hit(50, 'v2', l, 'E1') - hit(50, 'v2', l, 'E2')))
  const e0Ok =
    hit(10, 'v2', 'clean', 'E0') >= SHIP.e0CleanMin &&
    (['moderate', 'noisy'] as const).every(
      (l) => hit(10, 'v2', l, 'E0') - hit(10, 'baseline', l, 'E0') >= SHIP.e0MinDelta
    )
  return {
    objective: objectiveOf('v2'),
    baselineObjective: objectiveOf('baseline'),
    e2Drop,
    e0Ok,
    feasible: e0Ok && e2Drop <= SHIP.maxE2Drop
  }
}

/** The pre-registered choice among `summaries`. */
export function choose(summaries: SettingSummary[]): number {
  const ids = summaries.map((_, i) => i)
  const feasible = ids.filter((i) => summaries[i].feasible)
  if (feasible.length > 0)
    return feasible.reduce((a, b) => (summaries[b].objective > summaries[a].objective ? b : a))
  const e0 = ids.filter((i) => summaries[i].e0Ok)
  return (e0.length > 0 ? e0 : ids).reduce((a, b) => {
    const x = summaries[a]
    const y = summaries[b]
    return y.e2Drop < x.e2Drop || (y.e2Drop === x.e2Drop && y.objective > x.objective) ? b : a
  })
}

/** Settings no other setting beats on both a higher objective and a lower E2 drop. */
export function frontier(summaries: SettingSummary[]): number[] {
  const ids = summaries.map((_, i) => i)
  return ids
    .filter(
      (i) =>
        !ids.some(
          (j) =>
            summaries[j].objective >= summaries[i].objective &&
            summaries[j].e2Drop <= summaries[i].e2Drop &&
            (summaries[j].objective > summaries[i].objective ||
              summaries[j].e2Drop < summaries[i].e2Drop)
        )
    )
    .sort((a, b) => summaries[a].e2Drop - summaries[b].e2Drop)
}

export interface StepResult {
  label: string
  points: Overrides[]
  summaries: SettingSummary[]
  pick: number
}

export interface GreedyResult {
  chosen: Overrides
  summary: SettingSummary
  path: StepResult[]
}

/** Greedy coordinate search: each step picks among its grid merged over the previous choice. */
export function greedy(
  steps: TuneStep[],
  evaluate: (o: Overrides) => SettingSummary
): GreedyResult {
  let chosen: Overrides = {}
  const path: StepResult[] = []
  for (const step of steps) {
    const points = step.grid.map((g) => ({ ...chosen, ...g }))
    const summaries = points.map(evaluate)
    const pick = choose(summaries)
    path.push({ label: step.label, points, summaries, pick })
    chosen = points[pick]
  }
  const last = path[path.length - 1]
  return { chosen, summary: last.summaries[last.pick], path }
}

const pp = (x: number): string => (100 * x).toFixed(1)
export const formatOverrides = (o: Overrides): string =>
  Object.entries(o)
    .map(([k, v]) => `${k} = ${v}`)
    .join(', ') || 'spec defaults'

/** Markdown: chosen setting per outer fold, and the in-sample frontier of every greedy step. */
export function renderTuning(folds: GreedyResult[], inSample: GreedyResult): string {
  const same = folds.every((f) => formatOverrides(f.chosen) === formatOverrides(folds[0].chosen))
  const lines = [
    '## Nested tuning (training folds only)',
    '',
    'Each outer fold was scored with the setting chosen by a greedy coordinate search on the other',
    'four folds; every v2 number above is out-of-fold. Steps: ' +
      TUNING_STEPS.map((s) => s.label).join(' → ') +
      '.',
    'Objective: mean E1 Hit@10 over moderate + noisy, subject to E2 Hit@50 drop ≤ 2 pp at every',
    'level and E0 non-inferiority; otherwise the smallest E2 drop (scripts/shortlist-sim/phenotype/tuning.ts).',
    '',
    '| Outer fold | chosen setting | train E1 gain vs sprint 3 (pp) | train E2 drop (pp) | feasible |',
    '|---|---|---|---|---|',
    ...folds.map(
      (f, i) =>
        `| ${i} | ${formatOverrides(f.chosen)} | ${pp(f.summary.objective - f.summary.baselineObjective)} | ` +
        `${pp(f.summary.e2Drop)} | ${f.summary.feasible ? 'yes' : 'no'} |`
    ),
    '',
    `Chosen settings ${same ? 'are identical across folds' : 'differ between folds'}.`,
    '',
    '### Frontier per step: E1 gain vs E2 drop (all sampled diseases, in-sample, descriptive only)',
    ''
  ]
  for (const step of inSample.path) {
    lines.push(
      `**${step.label}** (in-sample pick: ${formatOverrides(step.points[step.pick])})`,
      '',
      '| setting | E1 gain vs sprint 3 (pp) | E2 Hit@50 drop (pp) | E0 non-inferior |',
      '|---|---|---|---|',
      ...frontier(step.summaries).map((i) => {
        const s = step.summaries[i]
        return `| ${formatOverrides(step.points[i])} | ${pp(s.objective - s.baselineObjective)} | ${pp(s.e2Drop)} | ${s.e0Ok ? 'yes' : 'no'} |`
      }),
      ''
    )
  }
  return lines.join('\n')
}
