/**
 * Aggregate markdown for the variant-level phenotype benchmark (#600). Consumes CaseResults
 * (ranks, counts) and score histograms only — no background rows reach this layer.
 */
import { CASE_MODES, type CaseMode, type CaseResult, type ScenarioId } from '../common/types'
import {
  clusterBootstrap,
  pairedClusterBootstrap,
  quantile,
  type Interval
} from '../stats/bootstrap'
import { caseHit, macroAverage, mean } from '../stats/metrics'
import { pooledModes, SHIP } from '../stats/ship'
import type { NoiseLevelId } from './profiles'
import { RESNIK_EDGES, RESNIK_HAND_POINTS } from './resnik-group'

export interface Calibration {
  levels: NoiseLevelId[]
  /** Per level: eligible background rows per score bin (`histWidth` wide; last = no score). */
  hist: number[][]
  histWidth: number
  /** Per level: the causal gene's score of every case. */
  causalScores: Array<Array<number | null>>
}

export interface PhenoReportInput {
  results: CaseResult[]
  tunedPoints: number[][]
  calibration: Calibration
  /** Production scorer open + score-all time per case and level (ms). */
  scoreMs: number[]
  cases: number
  eligibleCases: number
  reps: number
  seed: number
}

const KS = [1, 5, 10] as const
const LABEL: Record<string, string> = {
  a: '(a) varvis template, no phenotype',
  b: '(b) + varvis `hpo_sim_score` bins',
  c_tuned: '(c) + `hpo_resnik` bins, fold-tuned',
  c_hand: "(c') + `hpo_resnik` bins, hand-set",
  shuffled: "(c) with a random other disease's profile (control)"
}

const byGene = (c: CaseResult): string => c.gene
const macroHit = (k: number) => (cs: CaseResult[]) => macroAverage(cs, caseHit(k))
const meanDecoys = (cs: CaseResult[]): number => mean(cs.map((c) => c.decoysTop10))
const pct = (i: Interval): string =>
  `${(100 * i.estimate).toFixed(1)} [${(100 * i.lo).toFixed(1)}, ${(100 * i.hi).toFixed(1)}]`
const num = (i: Interval): string =>
  `${i.estimate.toFixed(2)} [${i.lo.toFixed(2)}, ${i.hi.toFixed(2)}]`

function scenarioTable(
  input: PhenoReportInput,
  scenario: ScenarioId,
  level: NoiseLevelId,
  modes: CaseMode[]
): { lines: string[]; safety?: { dHit10: Interval; dDecoys: Interval } } {
  const pick = (scorer: string): CaseResult[] =>
    input.results.filter(
      (r) => r.scorer === scorer && r.scenario === scenario && modes.includes(r.mode)
    )
  const { reps, seed } = input
  const ref = pick('a')
  const rows: Array<[string, CaseResult[]]> = [
    ['a', ref],
    ['b', pick('b')],
    ['c_tuned', pick(`c_tuned:${level}`)],
    ['c_hand', pick(`c_hand:${level}`)],
    ['shuffled', pick('c_tuned:shuffled')]
  ]
  let safety: { dHit10: Interval; dDecoys: Interval } | undefined
  const lines = rows.map(([id, cs]) => {
    const hits = KS.map((k) => pct(clusterBootstrap(cs, byGene, macroHit(k), reps, seed)))
    if (id === 'a') return `| ${LABEL[id]} | ${hits.join(' | ')} | – | – |`
    const dHit10 = pairedClusterBootstrap(cs, ref, byGene, macroHit(10), reps, seed)
    const dDecoys = pairedClusterBootstrap(cs, ref, byGene, meanDecoys, reps, seed)
    if (id === 'c_tuned') safety = { dHit10, dDecoys }
    return `| ${LABEL[id]} | ${hits.join(' | ')} | ${pct(dHit10)} | ${num(dDecoys)} |`
  })
  return { lines, safety }
}

/** Background score quantiles: deciles, with the top decile split further (the causal sits there). */
const CAL_QUANTILES = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99]

/** Score cut points at CAL_QUANTILES of the scored background rows, from the histogram. */
function quantileEdges(hist: number[], width: number): number[] {
  const scored = hist.slice(0, -1)
  const total = scored.reduce((s, x) => s + x, 0)
  const edges: number[] = []
  let cum = 0
  scored.forEach((n, i) => {
    cum += n
    while (edges.length < CAL_QUANTILES.length && cum >= CAL_QUANTILES[edges.length] * total)
      edges.push((i + 1) * width)
  })
  return edges
}

function calibrationSection(cal: Calibration): string[] {
  const lines = [
    '## Calibration of `hpo_resnik`',
    '',
    'Per noise level, scored eligible background rows are split at their score deciles (the top',
    'decile split again at the 95th and 99th percentile; rows of genes without HPO annotation',
    'separately); lift = share of causal genes in the bin ÷ share of background rows. A useful',
    'score has lift rising with the score.',
    ''
  ]
  cal.levels.forEach((level, li) => {
    const hist = cal.hist[li]
    const edges = [...new Set(quantileEdges(hist, cal.histWidth))]
    const bounds = [0, ...edges, Infinity]
    const bgTotal = hist.reduce((s, x) => s + x, 0)
    const scores = cal.causalScores[li]
    const row = (label: string, bg: number, causal: number): string =>
      `| ${label} | ${((100 * bg) / bgTotal).toFixed(1)} | ${((100 * causal) / scores.length).toFixed(1)} | ${bg === 0 ? '–' : (causal / scores.length / (bg / bgTotal)).toFixed(2)} |`
    lines.push(
      `**${level}**`,
      '',
      '| score range | background % | causal % | lift |',
      '|---|---|---|---|'
    )
    lines.push(row('no score', hist[hist.length - 1], scores.filter((s) => s === null).length))
    for (let d = 0; d + 1 < bounds.length; d++) {
      const [lo, hi] = [bounds[d], bounds[d + 1]]
      const bg = hist
        .slice(0, -1)
        .reduce(
          (s, n, i) =>
            s + ((i + 0.5) * cal.histWidth >= lo && (i + 0.5) * cal.histWidth < hi ? n : 0),
          0
        )
      const causal = scores.filter((s) => s !== null && s >= lo && s < hi).length
      lines.push(row(`${lo.toFixed(2)}–${hi === Infinity ? '∞' : hi.toFixed(2)}`, bg, causal))
    }
    lines.push('')
  })
  return lines
}

export function renderPhenoReport(input: PhenoReportInput): string {
  const primaryA = input.results.filter((r) => r.scorer === 'a' && r.scenario === 'primary')
  const modeCases: Partial<Record<CaseMode, number>> = {}
  for (const r of primaryA) modeCases[r.mode] = (modeCases[r.mode] ?? 0) + 1
  // A quick run has no stratum of 30 cases: then all modes, labelled underpowered anyway.
  const pooled = pooledModes(modeCases)
  const modes = pooled.length > 0 ? pooled : [...CASE_MODES]
  const genes = new Set(primaryA.map((r) => r.gene)).size
  const lines: string[] = [
    '## Variant-level benchmark (backgrounds)',
    '',
    `${input.cases} of ${input.eligibleCases} simulated cases have an HPO-annotated spiked disease`,
    `and enter; ${genes} gene clusters${genes < SHIP.minClusters ? ' (underpowered: < ' + SHIP.minClusters + ')' : ''}; pooled modes ${modes.join(', ')}.`,
    'Hit@k is macro-averaged over consequence classes under the production ordering; intervals',
    `are 95 % gene-cluster bootstrap (${input.reps} replicates), Δ is paired vs (a).`,
    `\`hpo_resnik\` bins: ≥ ${RESNIK_EDGES.join(' / ')} (fixed before any background was opened),`,
    `hand-set points ${RESNIK_HAND_POINTS.join(' / ')}; fold-tuned points (reference last):`,
    ...input.tunedPoints.map((p, f) => `fold ${f}: ${p.join(' / ')}`).map((s) => `- ${s}`),
    '',
    "Varvis `hpo_sim_score` comes from the background patient's own phenotype, not the simulated",
    'disease: any gain of (b) is a disease-gene prior (genes with a score), not a phenotype match.',
    'The control row ranks with a moderate profile of a random disease not linked to the causal',
    'gene: its gain over (a) is what `hpo_resnik` adds without a matching phenotype (an',
    '"annotated disease gene" prior).',
    ''
  ]
  const safety: string[] = []
  for (const scenario of ['primary', 'clinvar_visible'] as const) {
    for (const level of input.calibration.levels) {
      const t = scenarioTable(input, scenario, level, modes)
      lines.push(
        `### ${scenario}, ${level} profiles`,
        '',
        '| Scorer | Hit@1 % | Hit@5 % | Hit@10 % | ΔHit@10 vs (a), pp | Δ decoys in top 10 |',
        '|---|---|---|---|---|---|',
        ...t.lines,
        ''
      )
      if (scenario === 'clinvar_visible' && t.safety !== undefined) {
        const ok =
          t.safety.dHit10.lo > SHIP.visibleMinDeltaHit10 &&
          t.safety.dDecoys.hi <= SHIP.maxDeltaDecoys
        safety.push(
          `- ${level}: ΔHit@10 lower bound ${(100 * t.safety.dHit10.lo).toFixed(1)} pp (> −2 required), Δ decoys upper bound ${t.safety.dDecoys.hi.toFixed(2)} (≤ 0.5) → **${ok ? 'pass' : 'fail'}**`
        )
      }
    }
  }
  lines.push(
    '### Safety check, ClinVar visible ((c) fold-tuned vs (a), spec §11.5 item 3)',
    '',
    ...safety,
    ''
  )
  lines.push(...calibrationSection(input.calibration))
  const rank = (prefix: string): number[] =>
    input.results
      .filter((r) => r.scorer.startsWith(prefix) && r.ms !== undefined)
      .map((r) => r.ms!)
      .sort((x, y) => x - y)
  const ms = [...input.scoreMs].sort((x, y) => x - y)
  lines.push(
    '## Runtime',
    '',
    `Full shortlist ranking per case (median): (a) ${quantile(rank('a'), 0.5).toFixed(0)} ms, (c) ${quantile(rank('c_tuned'), 0.5).toFixed(0)} ms.`,
    `\`hpo_resnik\` alone (open + score all genes): median ${quantile(ms, 0.5).toFixed(1)} ms, p95 ${quantile(ms, 0.95).toFixed(1)} ms.`,
    ''
  )
  return lines.join('\n')
}
