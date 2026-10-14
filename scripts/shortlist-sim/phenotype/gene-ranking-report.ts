/** Metrics, ship criteria and markdown summary of the HPO scoring v2 gene-ranking benchmark (#600). */
import {
  clusterBootstrap,
  pairedClusterBootstrap,
  quantile,
  type Interval
} from '../stats/bootstrap'
import { mean, median, tieAveragedHit, tieAveragedReciprocal } from '../stats/metrics'
import { ARM_CONFIG, ARMS, type ArmId } from './arms'
import { NOISE_LEVELS, PROFILE_TERMS, UNKNOWN_FREQUENCY, type NoiseLevelId } from './profiles'

/** v2 = scorer under test (`openHpoGeneScorer`); sprint3 = frozen baseline (present terms only). */
export const SCORERS = ['v2', 'sprint3'] as const
export type ScorerId = (typeof SCORERS)[number]

export interface Standing {
  /** Genes scored strictly higher than the causal gene. */
  higher: number
  /** Other genes tied with it. */
  equal: number
  /** Spearman ρ of all gene scores vs gene annotation (term) counts, this case. */
  rho: number
  /** Spearman ρ of all gene scores vs gene disease counts, this case. */
  rhoDiseases: number
  /** ρ(score, gene term count) over the case's top TOP_RHO_GENES genes only (absent in old runs). */
  rhoTop100?: number
}

export interface GeneRankCase {
  disease: string
  level: NoiseLevelId
  arm: ArmId
  /** Gene-grouped fold of the causal gene (connected gene–disease component). */
  fold: number
  /** OMIM/ORPHA diseases of the causal gene. */
  geneDiseases: number
  /** Positive HPO terms of the causal gene (absent in old runs). */
  geneTerms?: number
  present: number
  excluded: number
  keys: number
  /** E2: a true frequent feature was excluded / a noise term was marked key. */
  falseExclusion: boolean
  noiseKey: boolean
  /** Scorer-under-test wall time for all genes (open → score). */
  ms: number
  scorers: Record<ScorerId, Standing>
}

/** Pre-registered ship criteria (spec §5); proportions, not percentage points. */
export const SHIP = {
  /** 1: E1 moderate + noisy ΔHit@10 vs sprint 3, and its CI lower bound. */
  e1MinDelta: 0.03,
  e1MinLower: 0.01,
  /** 2: E0 clean Hit@10 ≥ the sprint-3 run's one-sided 92.4 % − 1 pp; moderate/noisy Δ ≥ −0.5 pp. */
  e0CleanMin: 0.924 - 0.01,
  e0MinDelta: -0.005,
  /** 3: mean per-case ρ(score, gene term count), every arm × level. */
  maxRho: 0.4,
  /** 4: Hit@50 drop E1 → E2, every level. */
  maxE2Drop: 0.02,
  /** 5: p95 per-case latency for all genes. */
  maxP95Ms: 8
} as const

/** 1-based ranks, ties averaged. */
export function averageRanks(xs: Float64Array): Float64Array {
  // Comparison, not subtraction: scores may be -Infinity (no gene data).
  const order = Array.from(xs.keys()).sort((a, b) => (xs[a] < xs[b] ? -1 : xs[a] > xs[b] ? 1 : 0))
  const ranks = new Float64Array(xs.length)
  for (let i = 0; i < order.length;) {
    let j = i
    while (j + 1 < order.length && xs[order[j + 1]] === xs[order[i]]) j++
    for (let k = i; k <= j; k++) ranks[order[k]] = (i + j) / 2 + 1
    i = j + 1
  }
  return ranks
}

/** Spearman ρ of `xs` against pre-ranked `yRanks` (Pearson of the ranks); NaN if constant. */
export function spearman(xs: Float64Array, yRanks: Float64Array): number {
  const x = averageRanks(xs)
  const n = x.length
  const mx = (n + 1) / 2
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (yRanks[i] - mx)
    sxx += (x[i] - mx) ** 2
    syy += (yRanks[i] - mx) ** 2
  }
  return sxy / Math.sqrt(sxx * syy)
}

/**
 * Breadth bias where it matters: ρ among the case's top genes, not the 5,000 unrelated ones whose
 * expected score drives the all-gene ρ (s5 research, §0).
 */
export const TOP_RHO_GENES = 100

/** Spearman ρ of scores vs counts over the n best-scored genes (ties by gene order). */
export function topSpearman(scores: Float64Array, counts: Float64Array, n: number): number {
  const top = Array.from(scores.keys())
    .sort((a, b) => (scores[b] > scores[a] ? 1 : scores[b] < scores[a] ? -1 : a - b))
    .slice(0, n)
  return spearman(
    Float64Array.from(top, (i) => scores[i]),
    averageRanks(Float64Array.from(top, (i) => counts[i]))
  )
}

const REPS = 2000
const SEED = 20261015
const KS = [1, 10, 50, 100] as const
/** Causal genes with ≥ 2 diseases count as pleiotropic: every gene falls in one of two bins. */
const PLEIOTROPIC_MIN = 2

type Stat = (cs: GeneRankCase[], s: ScorerId) => number
const hit =
  (k: number): Stat =>
  (cs, s) =>
    mean(cs.map((c) => tieAveragedHit(c.scorers[s].higher, c.scorers[s].equal, k)))
const mrr: Stat = (cs, s) =>
  mean(cs.map((c) => tieAveragedReciprocal(c.scorers[s].higher, c.scorers[s].equal)))
const medianRank: Stat = (cs, s) =>
  median(cs.map((c) => c.scorers[s].higher + 1 + c.scorers[s].equal / 2))
const meanRho =
  (key: 'rho' | 'rhoDiseases' | 'rhoTop100'): Stat =>
  (cs, s) =>
    mean(cs.map((c) => c.scorers[s][key] ?? Number.NaN).filter(Number.isFinite))

const boot = (cs: GeneRankCase[], s: ScorerId, stat: Stat): Interval =>
  clusterBootstrap(
    cs,
    (c) => c.disease,
    (x) => stat(x, s),
    REPS,
    SEED
  )

/** Paired stat(a) − stat(b) over the same diseases, disease-clustered. */
export function pairedDelta(
  a: GeneRankCase[],
  sa: ScorerId,
  b: GeneRankCase[],
  sb: ScorerId,
  stat: Stat
): Interval {
  const tag = (cs: GeneRankCase[], s: ScorerId) => cs.map((c) => ({ c, s }))
  return pairedClusterBootstrap(
    tag(a, sa),
    tag(b, sb),
    (x) => x.c.disease,
    (xs) =>
      xs.length === 0
        ? Number.NaN
        : stat(
            xs.map((x) => x.c),
            xs[0].s
          ),
    REPS,
    SEED
  )
}

const pct = (i: Interval): string =>
  `${(100 * i.estimate).toFixed(1)} [${(100 * i.lo).toFixed(1)}, ${(100 * i.hi).toFixed(1)}]`
const num = (i: Interval, d: number): string =>
  `${i.estimate.toFixed(d)} [${i.lo.toFixed(d)}, ${i.hi.toFixed(d)}]`
const p = (x: number): string => (100 * x).toFixed(1)

const at = (cs: GeneRankCase[], level: NoiseLevelId, arm: ArmId): GeneRankCase[] =>
  cs.filter((c) => c.level === level && c.arm === arm)
const levels = (): NoiseLevelId[] => Object.keys(NOISE_LEVELS) as NoiseLevelId[]
const p95 = (cases: GeneRankCase[]): number =>
  quantile(
    cases.map((c) => c.ms).sort((a, b) => a - b),
    0.95
  )

export interface ShipCheck {
  criterion: string
  value: string
  threshold: string
  pass: boolean
}

export function shipChecks(cases: GeneRankCase[]): ShipCheck[] {
  const checks: ShipCheck[] = []
  for (const level of ['moderate', 'noisy'] as const) {
    const cs = at(cases, level, 'E1')
    const d = pairedDelta(cs, 'v2', cs, 'sprint3', hit(10))
    checks.push({
      criterion: `1. E1 ${level}: ΔHit@10 vs sprint 3 (pp)`,
      value: pct(d),
      threshold: `≥ ${p(SHIP.e1MinDelta)}, CI lo > ${p(SHIP.e1MinLower)}`,
      pass: d.estimate >= SHIP.e1MinDelta && d.lo > SHIP.e1MinLower
    })
  }
  const clean = hit(10)(at(cases, 'clean', 'E0'), 'v2')
  checks.push({
    criterion: '2. E0 clean: Hit@10 (%)',
    value: p(clean),
    threshold: `≥ ${p(SHIP.e0CleanMin)}`,
    pass: clean >= SHIP.e0CleanMin
  })
  for (const level of ['moderate', 'noisy'] as const) {
    const cs = at(cases, level, 'E0')
    const d = pairedDelta(cs, 'v2', cs, 'sprint3', hit(10))
    checks.push({
      criterion: `2. E0 ${level}: ΔHit@10 vs sprint 3 (pp)`,
      value: pct(d),
      threshold: `≥ ${p(SHIP.e0MinDelta)} (point estimate)`,
      pass: d.estimate >= SHIP.e0MinDelta
    })
  }
  const rhos = ARMS.flatMap((arm) => levels().map((l) => meanRho('rho')(at(cases, l, arm), 'v2')))
  const maxRho = Math.max(...rhos)
  checks.push({
    criterion: '3. ρ(score, gene term count), worst arm × level',
    value: maxRho.toFixed(2),
    threshold: `≤ ${SHIP.maxRho}`,
    pass: maxRho <= SHIP.maxRho
  })
  for (const level of levels()) {
    const d = pairedDelta(at(cases, level, 'E1'), 'v2', at(cases, level, 'E2'), 'v2', hit(50))
    checks.push({
      criterion: `4. ${level}: Hit@50 drop E1 → E2 (pp)`,
      value: pct(d),
      threshold: `≤ ${p(SHIP.maxE2Drop)} (point estimate)`,
      pass: d.estimate <= SHIP.maxE2Drop
    })
  }
  const lat = p95(cases)
  checks.push({
    criterion: '5. p95 latency per case, all genes (ms)',
    value: lat.toFixed(1),
    threshold: `≤ ${SHIP.maxP95Ms}`,
    pass: lat <= SHIP.maxP95Ms
  })
  return checks
}

function stratum(cases: GeneRankCase[], level: NoiseLevelId, arm: ArmId): string[] {
  const cs = at(cases, level, arm)
  const row = (s: ScorerId, label: string): string => {
    const hits = KS.map((k) => pct(boot(cs, s, hit(k)))).join(' | ')
    const rhos = (['rho', 'rhoTop100', 'rhoDiseases'] as const)
      .map((k) => meanRho(k)(cs, s).toFixed(2))
      .join(' | ')
    return `| ${label} | ${hits} | ${num(boot(cs, s, medianRank), 1)} | ${num(boot(cs, s, mrr), 3)} | ${rhos} |`
  }
  const delta = (stat: Stat): string => pct(pairedDelta(cs, 'v2', cs, 'sprint3', stat))
  const pleio = (s: ScorerId): string => {
    const single = cs.filter((c) => c.geneDiseases < PLEIOTROPIC_MIN)
    const multi = cs.filter((c) => c.geneDiseases >= PLEIOTROPIC_MIN)
    return `${s} ${p(hit(10)(single, s))} (n ${single.length}) vs ${p(hit(10)(multi, s))} (n ${multi.length})`
  }
  const counts = cs
    .map((c) => c.geneTerms ?? Number.NaN)
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
  const [t1, t2] = [quantile(counts, 1 / 3), quantile(counts, 2 / 3)]
  const terms = (c: GeneRankCase): number => c.geneTerms ?? Number.NaN
  const bins = [
    cs.filter((c) => terms(c) <= t1),
    cs.filter((c) => terms(c) > t1 && terms(c) <= t2),
    cs.filter((c) => terms(c) > t2)
  ]
  const tertiles = (s: ScorerId): string =>
    `${s} ` + bins.map((b) => `${p(hit(10)(b, s))} (n ${b.length})`).join(' / ')
  return [
    `### ${level} × ${arm} (${cs.length} cases; median ${median(cs.map((c) => c.present))} present, ` +
      `${median(cs.map((c) => c.excluded))} excluded, ${median(cs.map((c) => c.keys))} key)`,
    '',
    '| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | Hit@100 % | median rank | MRR | ρ(score, terms) | ' +
      `ρ top ${TOP_RHO_GENES} (terms) | ρ(score, diseases) |`,
    '|---|---|---|---|---|---|---|---|---|---|',
    row('v2', '**v2** (under test)'),
    row('sprint3', 'sprint 3 (frozen baseline)'),
    '',
    `Paired Δ v2 − sprint 3: Hit@1 ${delta(hit(1))}; Hit@10 ${delta(hit(10))}; ` +
      `Hit@50 ${delta(hit(50))} pp; MRR ${num(pairedDelta(cs, 'v2', cs, 'sprint3', mrr), 3)}.`,
    `Hit@10 single-disease vs pleiotropic (≥ ${PLEIOTROPIC_MIN} diseases) causal genes, %: ` +
      `${pleio('v2')}; ${pleio('sprint3')}.`,
    `Hit@10 by causal-gene term-count tertile (≤ ${t1.toFixed(0)} / ≤ ${t2.toFixed(0)} / more), %: ` +
      `${tertiles('v2')}; ${tertiles('sprint3')}.`,
    ''
  ]
}

export interface RunInfo {
  release: string
  diseases: number
  eligible: number
  genes: number
  /** Genes per fold. */
  foldGenes: number[]
  /** Resolved scorer options and their provenance; default: spec defaults, no tuning. */
  tuning?: string
}

export function renderGeneRanking(cases: GeneRankCase[], info: RunInfo): string {
  const e2 = cases.filter((c) => c.arm === 'E2')
  const noisyE2 = e2.filter((c) => c.level === ARM_CONFIG.noiseKeyLevel)
  const casesPerFold = info.foldGenes.map(
    (_, f) => cases.filter((c) => c.fold === f && c.arm === 'E0' && c.level === 'clean').length
  )
  const checks = shipChecks(cases)
  const lines: string[] = [
    '# HPO phenotype scoring v2: gene-ranking benchmark (public data)',
    '',
    `HPO release ${info.release}; ${info.diseases} of ${info.eligible} eligible OMIM/ORPHA diseases`,
    `(seeded sample, same seed and diseases as the sprint-3 run), every one of ${info.genes} genes`,
    `ranked per case. Profiles: ${PROFILE_TERMS} frequency-weighted true terms (unknown frequency =`,
    `${UNKNOWN_FREQUENCY}); noise levels as in sprint 3, crossed with arms E0/E1/E2 (spec §5):`,
    `E1 excludes ${ARM_CONFIG.exclusionCounts.join('–')} features with f ≥ ${ARM_CONFIG.mimicMinFrequency}`,
    `of the ${ARM_CONFIG.mimics} most similar other diseases (sprint-3 scorer on the true terms, the`,
    `causal gene's diseases excluded) outside the true disease's ancestor closure, and marks`,
    `${ARM_CONFIG.keyCounts.join('–')} true terms with the highest f·IC key; E2 adds one excluded true`,
    `feature with f ∈ [${ARM_CONFIG.falseExclusionMin}, ${ARM_CONFIG.falseExclusionMax}] and, in`,
    `${100 * ARM_CONFIG.noiseKeyShare} % of ${ARM_CONFIG.noiseKeyLevel} cases, a noise term marked key.`,
    `E2 composition: false exclusion in ${e2.filter((c) => c.falseExclusion).length}/${e2.length} cases,`,
    `noise key in ${noisyE2.filter((c) => c.noiseKey).length}/${noisyE2.length} ${ARM_CONFIG.noiseKeyLevel} cases.`,
    'The sprint-3 baseline is the frozen scorer (scripts/shortlist-sim/phenotype/sprint3-baseline.ts)',
    'on the builder-v2 DB; it sees the present terms only, which are identical across arms.',
    `Ranks are tie-averaged; intervals are 95 % percentile bootstrap over diseases (${REPS} replicates).`,
    '',
    `Folds: ${info.foldGenes.length} gene-grouped folds over connected gene–disease components;`,
    `genes per fold ${info.foldGenes.join(' / ')}, sampled diseases per fold ${casesPerFold.join(' / ')}.`,
    info.tuning ??
      '**No tuning in this run:** the spec defaults are evaluated on all folds, so every number here is\n' +
        'out-of-sample with respect to parameter fitting.',
    '',
    '## Ship criteria (spec §5)',
    '',
    '| Criterion | Value | Threshold | Result |',
    '|---|---|---|---|',
    ...checks.map(
      (c) => `| ${c.criterion} | ${c.value} | ${c.threshold} | ${c.pass ? 'PASS' : 'FAIL'} |`
    ),
    '',
    `**Verdict: ${checks.every((c) => c.pass) ? 'SHIP' : 'NO SHIP'}.**`,
    ''
  ]
  for (const level of levels()) {
    lines.push(`## ${level}`, '')
    for (const arm of ARMS) lines.push(...stratum(cases, level, arm))
  }
  const ms = cases.map((c) => c.ms).sort((a, b) => a - b)
  lines.push(
    `Scorer-under-test runtime per case (all genes): median ${quantile(ms, 0.5).toFixed(1)} ms, ` +
      `p95 ${quantile(ms, 0.95).toFixed(1)} ms (the first case includes the index load).`,
    ''
  )
  return lines.join('\n')
}
