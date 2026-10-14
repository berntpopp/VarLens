// Aggregates for the simulation report. Consumes CaseResults and the manifest only —
// no background rows ever reach this layer.
import {
  CASE_MODES,
  CONSEQUENCE_CLASSES,
  type CaseMode,
  type CaseResult,
  type RunManifest,
  type ScenarioId,
  XL_MODES
} from '../common/types'
import {
  clusterBootstrap,
  DEFAULT_REPS,
  pairedClusterBootstrap,
  type Interval
} from '../stats/bootstrap'
import { clopperPearsonLower } from '../stats/clopper-pearson'
import {
  burden,
  caseHit,
  caseReciprocal,
  caseTieHit,
  caseTieReciprocal,
  clusterSensitivityCounts,
  decoyIntrusion,
  filterSensitivity,
  macroAverage,
  mean,
  medianRank,
  rankCdf
} from '../stats/metrics'
import { evaluateShip, pooledModes, SHIP, type ShipVerdict } from '../stats/ship'

export const HIT_KS = [1, 5, 10, 20, 50] as const
export const CDF_KS = [1, 2, 3, 5, 10, 20, 30, 50, 100, 200, 500, 1000]
export const SCENARIOS: ScenarioId[] = [
  'primary',
  'clinvar_visible',
  'pheno_free',
  'pheno_shuffled',
  'missingness',
  'pheno_enriched'
]

export interface ScorerSummary {
  id: string
  label: string
  n: number
  hit: Record<number, number>
  hit10: Interval
  tieHit10: number
  mrr: number
  tieMrr: number
  medianRank: number
  decoys: { mean: number; shareAny: number }
  sensitivity: number
  sensitivityClusters: { n: number; failures: number; lower: number }
  burden: number
  /** Paired vs the reference scorer (absent for the reference itself). */
  deltaHit10?: Interval
  deltaDecoys?: Interval
}

export type Table = { columns: string[]; rows: Array<{ label: string; cells: string[] }> }

export interface ReportData {
  pooledModes: CaseMode[]
  droppedModes: CaseMode[]
  testGeneClusters: number
  underpowered: boolean
  scorers: ScorerSummary[]
  cdf: Array<{ id: string; label: string; points: Array<{ k: number; share: number }> }>
  /** Hit@10 per stratum and scorer; each value is a share (NaN = no cases). */
  byMode: Array<{ stratum: string; n: number; values: number[] }>
  byClass: Array<{ stratum: string; n: number; values: number[] }>
  byBackground: Array<{ stratum: string; n: number; values: number[] }>
  byTemporal: Array<{ stratum: string; n: number; values: number[] }>
  /** X-linked stratum (XLD + XLR, primary): candidate Hit@10 and Δ vs reference with intervals. */
  xl: { n: number; hit10: Interval; deltaHit10: Interval }
  scenarios: Array<{ scenario: ScenarioId; n: number; values: number[]; delta?: Interval }>
  ablations: Array<{ id: string; label: string; delta: Interval }>
  ship: ShipVerdict
}

const hit10 = caseHit(10)
const macroHit10 = (cs: CaseResult[]): number => macroAverage(cs, hit10)
const meanDecoys = (cs: CaseResult[]): number => mean(cs.map((c) => c.decoysTop10))
const byGene = (c: CaseResult): string => c.gene

/** Pairs every result with a fixed scorer order (manifest first, unknown ids appended). */
export function scorerOrder(
  manifest: RunManifest,
  results: CaseResult[]
): Array<{ id: string; label: string }> {
  const known = new Set(manifest.scorers.all.map((s) => s.id))
  const extra = [...new Set(results.map((r) => r.scorer))].filter((id) => !known.has(id))
  return [...manifest.scorers.all, ...extra.map((id) => ({ id, label: id }))]
}

function select(
  results: CaseResult[],
  scorer: string,
  scenario: ScenarioId,
  modes: CaseMode[]
): CaseResult[] {
  return results.filter(
    (r) => r.scorer === scorer && r.scenario === scenario && modes.includes(r.mode)
  )
}

function summarize(
  s: { id: string; label: string },
  cases: CaseResult[],
  refCases: CaseResult[] | null,
  reps: number,
  seed: number
): ScorerSummary {
  const hit: Record<number, number> = {}
  for (const k of HIT_KS) hit[k] = macroAverage(cases, caseHit(k))
  const counts = clusterSensitivityCounts(cases)
  return {
    ...s,
    n: cases.length,
    hit,
    hit10: clusterBootstrap(cases, byGene, macroHit10, reps, seed),
    tieHit10: macroAverage(cases, (c) => caseTieHit(c.alleles, 10)),
    mrr: macroAverage(cases, caseReciprocal),
    tieMrr: macroAverage(cases, (c) => caseTieReciprocal(c.alleles)),
    medianRank: medianRank(cases),
    decoys: decoyIntrusion(cases),
    sensitivity: filterSensitivity(cases),
    sensitivityClusters: {
      ...counts,
      lower: counts.n > 0 ? clopperPearsonLower(counts.n - counts.failures, counts.n) : Number.NaN
    },
    burden: burden(cases),
    ...(refCases
      ? {
          deltaHit10: pairedClusterBootstrap(cases, refCases, byGene, macroHit10, reps, seed),
          deltaDecoys: pairedClusterBootstrap(cases, refCases, byGene, meanDecoys, reps, seed)
        }
      : {})
  }
}

function strata(
  cases: CaseResult[],
  order: Array<{ id: string }>,
  keys: string[],
  keyOf: (c: CaseResult) => string,
  metric: (cs: CaseResult[]) => number,
  countScorer: string
): Array<{ stratum: string; n: number; values: number[] }> {
  return keys.map((stratum) => {
    const inStratum = cases.filter((c) => keyOf(c) === stratum)
    return {
      stratum,
      n: inStratum.filter((c) => c.scorer === countScorer).length,
      values: order.map((s) => {
        const cs = inStratum.filter((c) => c.scorer === s.id)
        return cs.length === 0 ? Number.NaN : metric(cs)
      })
    }
  })
}

interface Ctx {
  results: CaseResult[]
  order: Array<{ id: string; label: string }>
  modes: CaseMode[]
  reps: number
  seed: number
  reference: string
  candidate: string
  provisional: boolean
}

const pick = (ctx: Ctx, scorer: string, scenario: ScenarioId): CaseResult[] =>
  select(ctx.results, scorer, scenario, ctx.modes)

function scenarioRows(ctx: Ctx): ReportData['scenarios'] {
  return SCENARIOS.filter((sc) => ctx.results.some((r) => r.scenario === sc)).map((scenario) => {
    const ref = pick(ctx, ctx.reference, scenario)
    const cand = pick(ctx, ctx.candidate, scenario)
    return {
      scenario,
      n: cand.length,
      values: ctx.order.map((s) => {
        const cs = pick(ctx, s.id, scenario)
        return cs.length === 0 ? Number.NaN : macroHit10(cs)
      }),
      ...(ref.length && cand.length
        ? { delta: pairedClusterBootstrap(cand, ref, byGene, macroHit10, ctx.reps, ctx.seed) }
        : {})
    }
  })
}

function ablationRows(ctx: Ctx, ablations: string[]): ReportData['ablations'] {
  const cand = pick(ctx, ctx.candidate, 'primary')
  return ablations
    .map((id) => ({ id, cases: pick(ctx, id, 'primary') }))
    .filter((a) => a.cases.length > 0)
    .map((a) => ({
      id: a.id,
      label: ctx.order.find((s) => s.id === a.id)?.label ?? a.id,
      delta: pairedClusterBootstrap(a.cases, cand, byGene, macroHit10, ctx.reps, ctx.seed)
    }))
}

function shipVerdict(
  ctx: Ctx,
  scorers: ScorerSummary[],
  modeCases: Partial<Record<CaseMode, number>>
): ShipVerdict {
  const candPrimary = pick(ctx, ctx.candidate, 'primary')
  const visibleDelta = (metric: (cs: CaseResult[]) => number): Interval =>
    pairedClusterBootstrap(
      pick(ctx, ctx.candidate, 'clinvar_visible'),
      pick(ctx, ctx.reference, 'clinvar_visible'),
      byGene,
      metric,
      ctx.reps,
      ctx.seed
    )
  const cand = scorers.find((s) => s.id === ctx.candidate)
  const nan: Interval = { estimate: Number.NaN, lo: Number.NaN, hi: Number.NaN }
  return evaluateShip({
    testGeneClusters: new Set(candPrimary.map(byGene)).size,
    modeCases,
    primary: { deltaHit10: cand?.deltaHit10 ?? nan, deltaDecoys: cand?.deltaDecoys ?? nan },
    clinvarVisible: { deltaHit10: visibleDelta(macroHit10), deltaDecoys: visibleDelta(meanDecoys) },
    sensitivity: clusterSensitivityCounts(candPrimary),
    provisional: ctx.provisional
  })
}

function strataRows(
  ctx: Ctx
): Pick<ReportData, 'byMode' | 'byClass' | 'byBackground' | 'byTemporal' | 'xl'> {
  const primaryAll = ctx.results.filter((r) => r.scenario === 'primary')
  const xl = (scorer: string): CaseResult[] =>
    primaryAll.filter((r) => r.scorer === scorer && XL_MODES.includes(r.mode))
  const xlCand = xl(ctx.candidate)
  const primary = primaryAll.filter((r) => ctx.modes.includes(r.mode))
  const backgrounds = [...new Set(primaryAll.map((r) => r.bg))].sort()
  const temporal = (c: CaseResult): string => (c.newSince2024 ? 'new since 2024' : 'older')
  const row = (
    cases: CaseResult[],
    keys: string[],
    keyOf: (c: CaseResult) => string,
    metric: (cs: CaseResult[]) => number
  ): ReturnType<typeof strata> => strata(cases, ctx.order, keys, keyOf, metric, ctx.candidate)
  return {
    // Every mode is shown, including strata dropped from the pooled endpoint.
    byMode: row(primaryAll, [...CASE_MODES], (c) => c.mode, macroHit10),
    byClass: row(
      primary,
      [...CONSEQUENCE_CLASSES],
      (c) => c.consequenceClass,
      (cs) => mean(cs.map(hit10))
    ),
    byBackground: row(primary, backgrounds, (c) => c.bg, macroHit10),
    byTemporal: row(primary, ['new since 2024', 'older'], temporal, macroHit10),
    xl: {
      n: xlCand.length,
      hit10: clusterBootstrap(xlCand, byGene, macroHit10, ctx.reps, ctx.seed),
      deltaHit10: pairedClusterBootstrap(
        xlCand,
        xl(ctx.reference),
        byGene,
        macroHit10,
        ctx.reps,
        ctx.seed
      )
    }
  }
}

export function analyze(results: CaseResult[], manifest: RunManifest): ReportData {
  const { reference, candidate } = manifest.scorers
  const modeCases: Partial<Record<CaseMode, number>> = {}
  for (const r of results) {
    if (r.scorer === candidate && r.scenario === 'primary')
      modeCases[r.mode] = (modeCases[r.mode] ?? 0) + 1
  }
  const ctx: Ctx = {
    results,
    order: scorerOrder(manifest, results),
    modes: pooledModes(modeCases),
    reps: manifest.bootstrapReps || DEFAULT_REPS,
    seed: manifest.seeds.bootstrap ?? 1,
    reference,
    candidate,
    provisional: manifest.provisional === true
  }
  const refPrimary = pick(ctx, reference, 'primary')
  const scorers = ctx.order.map((s) =>
    summarize(
      s,
      pick(ctx, s.id, 'primary'),
      s.id === reference ? null : refPrimary,
      ctx.reps,
      ctx.seed
    )
  )
  const testGeneClusters = new Set(pick(ctx, candidate, 'primary').map(byGene)).size
  const ship = shipVerdict(ctx, scorers, modeCases)
  return {
    pooledModes: ctx.modes,
    droppedModes: ship.droppedModes,
    testGeneClusters,
    underpowered: testGeneClusters < SHIP.minClusters,
    scorers,
    cdf: ctx.order.map((s) => ({ ...s, points: rankCdf(pick(ctx, s.id, 'primary'), CDF_KS) })),
    ...strataRows(ctx),
    scenarios: scenarioRows(ctx),
    ablations: ablationRows(ctx, manifest.scorers.ablations),
    ship
  }
}
