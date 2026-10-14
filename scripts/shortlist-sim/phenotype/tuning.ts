/**
 * Nested cross-validated tuning of the v2 phenotype scorer on real cases (#600): the
 * pre-registered greedy search of `.planning/artifacts/shortlist-sim/2026-10-14-hpo-v2/
 * external-tuning.md`. Pure; tune-external.ts supplies the objective.
 */

/** Scorer option overrides (`HpoScoringOptions` fields). */
export type Overrides = Record<string, number | string>

export interface TuneStep {
  label: string
  /** Each point is merged over the setting chosen by the previous steps. */
  grid: Overrides[]
  /** Run the step only when this holds for the setting chosen so far. */
  when?: (chosen: Overrides) => boolean
}

const cross = (a: Overrides[], b: Overrides[]): Overrides[] =>
  a.flatMap((x) => b.map((y) => ({ ...x, ...y })))
const axis = (key: string, values: ReadonlyArray<number | string>): Overrides[] =>
  values.map((v) => ({ [key]: v }))

/** τ arms of step 1; each needs its own DB (the stored background null is τ-specific). */
export const EXTERNAL_TAUS = [0, 0.5, 1] as const

/**
 * The v2 spec defaults the protocol was registered and first run with (hpo-scoring.config.ts at
 * d013c6e8): comparator (b) and the start of every search. Frozen here so later config changes
 * (the shipped τ = 1 / conflicts only) cannot move the historical comparator.
 */
export const ORIGINAL_V2: Overrides = {
  tau: 0,
  correction: 'off',
  exclusionMode: 'penalty',
  excludeMinFrequency: 0
}

/**
 * Pre-registered order and grids. Step 2 is joint because the scorer couples them: correction
 * `off`/`mean` applies exclusions multiplicatively, `z` the error-tolerant LR (B1). keyWeight is
 * not tuned: phenopackets carry no key terms.
 */
export const EXTERNAL_STEPS: TuneStep[] = [
  { label: 'C1 IC-weighted forward (τ)', grid: axis('tau', EXTERNAL_TAUS) },
  {
    label: 'A1 correction × exclusion mode',
    grid: cross(
      [
        { correction: 'off' },
        { correction: 'mean' },
        ...cross(axis('correction', ['z']), axis('geneMaxPenalty', [0, 0.5, 1]))
      ],
      [
        { exclusionMode: 'penalty', excludeMinFrequency: 0 },
        { exclusionMode: 'penalty', excludeMinFrequency: 0.8 },
        { exclusionMode: 'penalty', excludeMinFrequency: 0.95 },
        { exclusionMode: 'conflictsOnly' }
      ]
    )
  },
  {
    label: 'B1 ε × λ_z',
    grid: cross(axis('lrEpsilon', [0.05, 0.1, 0.2, 0.3]), axis('lambdaZ', [0.25, 0.5, 1])),
    when: (o) => o.correction === 'z' && o.exclusionMode === 'penalty'
  }
]

/** Sensitivity analysis (not registered): τ searched jointly with step 2 instead of first. */
export const EXTERNAL_JOINT: TuneStep[] = [
  {
    label: 'joint τ × correction × exclusion mode',
    grid: cross(axis('tau', EXTERNAL_TAUS), EXTERNAL_STEPS[1].grid)
  }
]

export interface StepResult {
  label: string
  points: Overrides[]
  objectives: number[]
  pick: number
}

export interface GreedyResult {
  chosen: Overrides
  objective: number
  path: StepResult[]
}

/**
 * Greedy coordinate search maximising `objective`, every point merged over `start`; ties keep the
 * earlier grid point.
 */
export function greedy(
  steps: TuneStep[],
  objective: (o: Overrides) => number,
  start: Overrides
): GreedyResult {
  let chosen: Overrides = start
  let best = Number.NaN
  const path: StepResult[] = []
  for (const step of steps) {
    if (step.when !== undefined && !step.when(chosen)) continue
    const points = step.grid.map((g) => ({ ...chosen, ...g }))
    const objectives = points.map(objective)
    const pick = objectives.reduce((a, v, i) => (v > objectives[a] ? i : a), 0)
    path.push({ label: step.label, points, objectives, pick })
    chosen = points[pick]
    best = objectives[pick]
  }
  return { chosen, objective: best, path }
}

export const formatOverrides = (o: Overrides): string =>
  Object.entries(o)
    .map(([k, v]) => `${k} = ${v}`)
    .join(', ') || 'spec defaults'
