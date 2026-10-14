/** Metrics and markdown summary for the public-data hpo_resnik gene-ranking benchmark (#600). */
import {
  clusterBootstrap,
  pairedClusterBootstrap,
  quantile,
  type Interval
} from '../stats/bootstrap'
import { mean, median, tieAveragedHit, tieAveragedReciprocal } from '../stats/metrics'
import { NOISE_LEVELS, PROFILE_TERMS, UNKNOWN_FREQUENCY, type NoiseLevelId } from './profiles'

/** resnik = production `hpo_resnik`; overlap = harness-only reference baseline. */
export const SCORERS = ['resnik', 'overlap'] as const
export type ScorerId = (typeof SCORERS)[number]

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
  /** Production scorer wall time for all genes (open → score). */
  ms: number
  /** ScorerId keys; a `--before` run may carry other (retired) scorers. */
  scorers: Record<string, Standing>
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

function metrics(cases: GeneRankCase[], scorer: string): Record<string, Interval> {
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

/** One table row: a scorer of one run, restricted to one noise level. */
interface Row {
  label: string
  cases: GeneRankCase[]
  scorer: string
}

/** Paired ΔHit@10 a − b over the same diseases (one case per disease and level). */
function hit10Delta(a: Row, b: Row): Interval {
  const v = (r: Row) => (c: GeneRankCase) => ({
    disease: c.disease,
    v: tieAveragedHit(c.scorers[r.scorer].higher, c.scorers[r.scorer].equal, 10)
  })
  return pairedClusterBootstrap(
    a.cases.map(v(a)),
    b.cases.map(v(b)),
    (x) => x.disease,
    (xs) => mean(xs.map((x) => x.v)),
    REPS,
    SEED
  )
}

function rowLine(r: Row): string {
  const m = metrics(r.cases, r.scorer)
  const rho = mean(r.cases.map((c) => c.scorers[r.scorer].rho).filter(Number.isFinite))
  const hits = KS.map((k) => pct(m[`Hit@${k}`])).join(' | ')
  return `| ${r.label} | ${hits} | ${num(m['median rank'], 1)} | ${num(m.MRR, 3)} | ${rho.toFixed(2)} |`
}

function runtime(cases: GeneRankCase[]): string {
  const ms = cases.map((c) => c.ms).sort((a, b) => a - b)
  return `median ${quantile(ms, 0.5).toFixed(0)} ms, p95 ${quantile(ms, 0.95).toFixed(0)} ms`
}

export interface RunInfo {
  release: string
  diseases: number
  eligible: number
  genes: number
}

/**
 * Summary of one run; with `before` (an earlier run on the same diseases and profiles) each
 * level also shows its one-sided `hpo_resnik` and in-memory symmetric reference rows.
 */
export function renderGeneRanking(
  cases: GeneRankCase[],
  info: RunInfo,
  before?: GeneRankCase[]
): string {
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
    const at = (cs: GeneRankCase[]): GeneRankCase[] => cs.filter((c) => c.level === level)
    const after: Row = { label: '**after**: `hpo_resnik`', cases: at(cases), scorer: 'resnik' }
    const overlap: Row = {
      label: 'exact term overlap (reference)',
      cases: at(cases),
      scorer: 'overlap'
    }
    const old: Row[] =
      before === undefined
        ? []
        : [
            { label: 'before: `hpo_resnik` (patient→gene)', cases: at(before), scorer: 'resnik' },
            { label: 'before: symmetric BMA (harness)', cases: at(before), scorer: 'symmetric' }
          ]
    lines.push(
      `## ${level} (${after.cases.length} cases, median profile ${median(after.cases.map((c) => c.profileSize))} terms)`,
      '',
      '| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | Hit@100 % | median rank | MRR | ρ(score, annotation count) |',
      '|---|---|---|---|---|---|---|---|',
      ...[...old, after, overlap].map(rowLine),
      '',
      'Paired ΔHit@10 of after (pp): ' +
        [...old.slice(0, 1), overlap]
          .map((r) => `vs ${r.label} ${pct(hit10Delta(after, r))}`)
          .join('; '),
      ''
    )
  }
  lines.push(
    `Production scorer runtime per case (all genes): ${runtime(cases)}` +
      (before === undefined ? '.' : `; before ${runtime(before)}.`),
    ''
  )
  return lines.join('\n')
}
