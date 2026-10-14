/** Metrics and markdown summary for the public-data hpo_resnik gene-ranking benchmark (#600). */
import {
  clusterBootstrap,
  pairedClusterBootstrap,
  quantile,
  type Interval
} from '../stats/bootstrap'
import { mean, median, tieAveragedHit, tieAveragedReciprocal } from '../stats/metrics'
import { NOISE_LEVELS, PROFILE_TERMS, UNKNOWN_FREQUENCY, type NoiseLevelId } from './profiles'

/** resnik = production patient→gene BMA; the others are reference baselines (harness only). */
export const SCORERS = ['resnik', 'reverse', 'symmetric', 'overlap'] as const
export type ScorerId = (typeof SCORERS)[number]
const SCORER_LABEL: Record<ScorerId, string> = {
  resnik: '`hpo_resnik` (patient→gene BMA, production)',
  reverse: 'gene→patient BMA',
  symmetric: 'symmetric BMA (mean of both)',
  overlap: 'exact term overlap count'
}

export interface Standing {
  /** Genes scored strictly higher than the causal gene. */
  higher: number
  /** Other genes tied with it. */
  equal: number
  /** Spearman ρ of all gene scores vs gene annotation counts, this case. */
  rho: number
}

export interface GeneRankCase {
  disease: string
  level: NoiseLevelId
  profileSize: number
  /** Production scorer wall time for all genes (open → score → close). */
  ms: number
  scorers: Record<ScorerId, Standing>
}

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

const REPS = 2000
const SEED = 20261015
const KS = [1, 10, 50, 100] as const

const expectedRank = (s: Standing): number => s.higher + 1 + s.equal / 2

function metrics(cases: GeneRankCase[], scorer: ScorerId): Record<string, Interval> {
  const boot = (stat: (c: GeneRankCase[]) => number): Interval =>
    clusterBootstrap(cases, (c) => c.disease, stat, REPS, SEED)
  const st = (c: GeneRankCase): Standing => c.scorers[scorer]
  const out: Record<string, Interval> = {}
  for (const k of KS)
    out[`Hit@${k}`] = boot((cs) =>
      mean(cs.map((c) => tieAveragedHit(st(c).higher, st(c).equal, k)))
    )
  out['median rank'] = boot((cs) => median(cs.map((c) => expectedRank(st(c)))))
  out.MRR = boot((cs) => mean(cs.map((c) => tieAveragedReciprocal(st(c).higher, st(c).equal))))
  return out
}

const pct = (i: Interval): string =>
  `${(100 * i.estimate).toFixed(1)} [${(100 * i.lo).toFixed(1)}, ${(100 * i.hi).toFixed(1)}]`
const num = (i: Interval, d: number): string =>
  `${i.estimate.toFixed(d)} [${i.lo.toFixed(d)}, ${i.hi.toFixed(d)}]`

function hit10Delta(cases: GeneRankCase[], base: ScorerId): Interval {
  const v = (s: ScorerId) => (c: GeneRankCase) => ({
    disease: c.disease,
    v: tieAveragedHit(c.scorers[s].higher, c.scorers[s].equal, 10)
  })
  return pairedClusterBootstrap(
    cases.map(v('resnik')),
    cases.map(v(base)),
    (x) => x.disease,
    (xs) => mean(xs.map((x) => x.v)),
    REPS,
    SEED
  )
}

export interface RunInfo {
  release: string
  diseases: number
  eligible: number
  genes: number
}

export function renderGeneRanking(cases: GeneRankCase[], info: RunInfo): string {
  const lines: string[] = [
    '# hpo_resnik gene-ranking benchmark (public data)',
    '',
    `HPO release ${info.release}; ${info.diseases} of ${info.eligible} eligible OMIM/ORPHA diseases`,
    `(seeded sample), every one of ${info.genes} genes in genes_to_phenotype.txt ranked per case.`,
    `Profiles: ${PROFILE_TERMS} frequency-weighted true terms (unknown frequency = ${UNKNOWN_FREQUENCY}),`,
    'the same true terms in every stratum; causal gene drawn uniformly from the disease genes.',
    'Ranks are tie-averaged; intervals are 95 % percentile bootstrap over diseases',
    `(${REPS} replicates).`,
    '',
    '| Noise level | imprecision | steps up | noise terms |',
    '|---|---|---|---|',
    ...Object.entries(NOISE_LEVELS).map(
      ([id, l]) => `| ${id} | ${l.imprecision} | ${l.steps} | ${l.noise} |`
    ),
    ''
  ]
  for (const level of Object.keys(NOISE_LEVELS) as NoiseLevelId[]) {
    const cs = cases.filter((c) => c.level === level)
    lines.push(
      `## ${level} (${cs.length} cases, median profile ${median(cs.map((c) => c.profileSize))} terms)`,
      '',
      '| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | Hit@100 % | median rank | MRR | ρ(score, annotation count) |',
      '|---|---|---|---|---|---|---|---|'
    )
    for (const s of SCORERS) {
      const m = metrics(cs, s)
      const rho = mean(cs.map((c) => c.scorers[s].rho).filter(Number.isFinite))
      lines.push(
        `| ${SCORER_LABEL[s]} | ${KS.map((k) => pct(m[`Hit@${k}`])).join(' | ')} | ${num(m['median rank'], 1)} | ${num(m.MRR, 3)} | ${rho.toFixed(2)} |`
      )
    }
    lines.push(
      '',
      'Paired ΔHit@10 (`hpo_resnik` − baseline, pp): ' +
        SCORERS.filter((s) => s !== 'resnik')
          .map((s) => `${s} ${pct(hit10Delta(cs, s))}`)
          .join('; '),
      ''
    )
  }
  const ms = cases.map((c) => c.ms).sort((a, b) => a - b)
  lines.push(
    `Runtime of the production scorer per case (all ${info.genes} genes, open → score → close):`,
    `median ${quantile(ms, 0.5).toFixed(0)} ms, p95 ${quantile(ms, 0.95).toFixed(0)} ms.`,
    ''
  )
  return lines.join('\n')
}
