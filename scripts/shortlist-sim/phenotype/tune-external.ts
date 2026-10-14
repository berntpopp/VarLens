/**
 * Nested cross-validated tuning of the v2 phenotype scorer on phenopacket-store (#600), following
 * the pre-registered protocol `.planning/artifacts/shortlist-sim/2026-10-14-hpo-v2/external-tuning.md`:
 *
 *   npx jiti scripts/shortlist-sim/phenotype/tune-external.ts --release <tag> --run <name> [--sample N]
 *
 * `--sample N` keeps every ⌈cases / N⌉-th case (smoke test only; not the protocol).
 *
 * Cases as in external-phenopackets.ts. Every setting is scored through the production scorer
 * (`scoreCase` with option overrides); standings are computed once per setting over all cases
 * and shared by every fold. Writes runs/<name>/{cases.json, tuning.json, external-tuning.md}.
 *
 * Sensitivity analyses (not registered; the primary analysis is unchanged): (a) "non-cited" with
 * citations of every disease of the causal gene, (b) folds grouped by connected gene–disease–
 * publication component, (c) a joint τ × correction × exclusion-mode search.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadPhenotypeIndex } from '../../../src/main/services/phenotype/hpo-similarity-db'
import { HPO_SCORING_CONFIG } from '../../../src/shared/config/hpo-scoring.config'
import type { PhenotypeIndex } from '../../../src/shared/phenotype/phenotype-index'
import { scoreCase } from '../../../src/shared/phenotype/phenotype-score'
import {
  parseGenesToPhenotype,
  parseHpoaDiseaseTerms
} from '../../../src/shared/phenotype/hpo-sources'
import type { HpoProfileTerm } from '../../../src/shared/types/hpo-profile'
import { DATA_DIR, HPO_DB_SPRINT3, HPO_RAW_DIR, hpoDbForTau } from '../common/paths'
import { clusterBootstrap, quantile, type Interval } from '../stats/bootstrap'
import { componentFolds, geneFolds } from '../stats/folds'
import { mean, tieAveragedHit, tieAveragedReciprocal } from '../stats/metrics'
import { runArgs, standing } from './bench-setup'
import { citedByHpoa, hpoaReferences, jsonFiles, parsePhenopacket } from './phenopackets'
import { parseDiseases } from './profiles'
import { buildHpoIndex, readSprint3Input, scoreAllGenes } from './sprint3-baseline'
import {
  EXTERNAL_JOINT,
  EXTERNAL_STEPS,
  EXTERNAL_TAUS,
  formatOverrides,
  greedy,
  ORIGINAL_V2,
  type GreedyResult,
  type Overrides,
  type TuneStep
} from './tuning'

const FOLDS = 5
const SEED = 20261017
const REPS = 2000
/** Primary ship rule (protocol): non-inferior to v2 observed-only, and ahead of sprint 3. */
const RULE = { minDelta: 0, minLower: -0.02, minVsSprint3: 0.05 } as const

/** The shipped defaults (hpo-scoring.config.ts), keyed like the search points so they share the memo. */
const SHIPPED: Overrides = {
  tau: HPO_SCORING_CONFIG.tau,
  correction: HPO_SCORING_CONFIG.backgroundCorrection,
  exclusionMode: HPO_SCORING_CONFIG.exclusionMode,
  excludeMinFrequency: HPO_SCORING_CONFIG.excludeMinFrequency
}

type Standing = { higher: number; equal: number }
const SCORERS = ['sprint3', 'v2Present', 'tunedPresent', 'tuned'] as const
type ScorerId = (typeof SCORERS)[number] | 'shipped' | 'tunedComponent' | 'tunedJoint'
const LABELS: Record<ScorerId, string> = {
  sprint3: '(a) sprint 3, observed',
  v2Present: '(b) original v2 (τ 0, penalty, correction off), observed',
  tunedPresent: '(b′) chosen setting, observed',
  tuned: '(t) chosen setting, observed + excluded',
  shipped: 'shipped defaults (fixed), observed + excluded',
  tunedComponent: '(t) with component + publication folds',
  tunedJoint: '(t) with joint τ × correction × exclusion search'
}

interface TuneCase {
  gene: string
  cited: boolean
  /** Sensitivity (a): cited by HPOA for any disease of the causal gene. */
  citedGene: boolean
  fold: number
  ms: number
  scorers: Record<ScorerId, Standing>
}

type Stat = (cs: TuneCase[], s: ScorerId) => number
const hit =
  (k: number): Stat =>
  (cs, s) =>
    mean(cs.map((c) => tieAveragedHit(c.scorers[s].higher, c.scorers[s].equal, k)))
const mrr: Stat = (cs, s) =>
  mean(cs.map((c) => tieAveragedReciprocal(c.scorers[s].higher, c.scorers[s].equal)))
const boot = (cs: TuneCase[], f: (x: TuneCase[]) => number): Interval =>
  clusterBootstrap(cs, (c) => c.gene, f, REPS, SEED)
const pct = (i: Interval): string =>
  `${(100 * i.estimate).toFixed(1)} [${(100 * i.lo).toFixed(1)}, ${(100 * i.hi).toFixed(1)}]`

function table(title: string, cs: TuneCase[]): string[] {
  const d = (a: ScorerId, b: ScorerId): string =>
    pct(boot(cs, (x) => hit(10)(x, a) - hit(10)(x, b)))
  return [
    `### ${title} (${cs.length} cases, ${new Set(cs.map((c) => c.gene)).size} genes)`,
    '',
    '| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | MRR |',
    '|---|---|---|---|---|',
    ...SCORERS.map(
      (s) =>
        `| ${LABELS[s]} | ${[1, 10, 50].map((k) => pct(boot(cs, (x) => hit(k)(x, s)))).join(' | ')} | ` +
        `${boot(cs, (x) => mrr(x, s)).estimate.toFixed(3)} |`
    ),
    '',
    `Paired ΔHit@10 (pp): (t) − (b) ${d('tuned', 'v2Present')}; (t) − (a) ${d('tuned', 'sprint3')}; ` +
      `(t) − (b′) ${d('tuned', 'tunedPresent')}.`,
    ''
  ]
}

const foldRows = (folds: GreedyResult[]): string[] => [
  '| Outer fold | chosen on the other four | training Hit@10 % |',
  '|---|---|---|',
  ...folds.map(
    (f, i) => `| ${i} | ${formatOverrides(f.chosen)} | ${(100 * f.objective).toFixed(1)} |`
  )
]

interface Sensitivity {
  componentFolds: GreedyResult[]
  componentSizes: number[]
  jointFolds: GreedyResult[]
  /** Hit@10 of τ ∈ EXTERNAL_TAUS at the shipped correction and exclusion mode, in-sample. */
  tauRows: Array<{ tau: number; all: number; nonCited: number; nonCitedGene: number }>
}

function renderSensitivity(cases: TuneCase[], s: Sensitivity): string[] {
  const subsets: Array<[string, TuneCase[]]> = [
    ['non-cited, registered', cases.filter((c) => !c.cited)],
    ['(a) non-cited, citations of all diseases of the gene', cases.filter((c) => !c.citedGene)]
  ]
  const scorers: ScorerId[] = ['shipped', 'tuned', 'tunedComponent', 'tunedJoint']
  const d = (cs: TuneCase[], a: ScorerId, b: ScorerId): string =>
    pct(boot(cs, (x) => hit(10)(x, a) - hit(10)(x, b)))
  return [
    '## Sensitivity analyses (added after the result; the registered analysis above is unchanged)',
    '',
    '(a) cases whose PMID HPOA cites for any disease of the causal gene count as cited; (b) outer',
    'folds group connected gene–disease–publication components (`componentFolds`); (c) τ is',
    'searched jointly with correction × exclusion mode (60 settings) instead of first. Paired',
    `ΔHit@10 in pp, gene-clustered bootstrap (${REPS} replicates).`,
    '',
    '| Subset | Scorer | Hit@10 % | Δ vs (b) original v2 | Δ vs (a) sprint 3 |',
    '|---|---|---|---|---|',
    ...subsets.flatMap(([name, cs]) =>
      scorers.map(
        (sc) =>
          `| ${name} (${cs.length} cases, ${new Set(cs.map((c) => c.gene)).size} genes) | ` +
          `${LABELS[sc]} | ${pct(boot(cs, (x) => hit(10)(x, sc)))} | ` +
          `${d(cs, sc, 'v2Present')} | ${d(cs, sc, 'sprint3')} |`
      )
    ),
    '',
    `(b) Component + publication folds (genes per fold ${s.componentSizes.join(' / ')}):`,
    '',
    ...foldRows(s.componentFolds),
    '',
    '(c) Joint search, gene folds:',
    '',
    ...foldRows(s.jointFolds),
    '',
    `(c) τ at correction = ${String(SHIPPED.correction)}, exclusionMode = ${String(SHIPPED.exclusionMode)}, ` +
      'Hit@10 % (in-sample, descriptive):',
    '',
    '| τ | all cases | non-cited | (a) non-cited, gene-wide |',
    '|---|---|---|---|',
    ...s.tauRows.map(
      (r) =>
        `| ${r.tau} | ${(100 * r.all).toFixed(1)} | ${(100 * r.nonCited).toFixed(1)} | ${(100 * r.nonCitedGene).toFixed(1)} |`
    ),
    ''
  ]
}

function render(
  cases: TuneCase[],
  folds: GreedyResult[],
  frozen: GreedyResult,
  sensitivity: Sensitivity
): string {
  const clean = cases.filter((c) => !c.cited)
  const vsB = boot(clean, (x) => hit(10)(x, 'tuned') - hit(10)(x, 'v2Present'))
  const vsA = boot(clean, (x) => hit(10)(x, 'tuned') - hit(10)(x, 'sprint3'))
  const nonInferior = vsB.estimate >= RULE.minDelta && vsB.lo >= RULE.minLower
  const ahead = vsA.estimate >= RULE.minVsSprint3
  const ms = cases.map((c) => c.ms).sort((a, b) => a - b)
  const stepRows = frozen.path.flatMap((st) => [
    `**${st.label}** (pick: ${formatOverrides(st.points[st.pick])})`,
    '',
    '| setting | training Hit@10 % (all cases) |',
    '|---|---|',
    ...st.points.map(
      (p, i) => `| ${formatOverrides(p)} | ${(100 * st.objectives[i]).toFixed(1)} |`
    ),
    ''
  ])
  return [
    '## Results',
    '',
    '### Primary ship rule (non-cited, out-of-fold Hit@10)',
    '',
    '| Check | Value (pp) | Threshold | Result |',
    '|---|---|---|---|',
    `| (t) − (b) v2 observed-only | ${pct(vsB)} | ≥ 0, CI lo ≥ −2 | ${nonInferior ? 'PASS' : 'FAIL'} |`,
    `| (t) − (a) sprint 3 | ${pct(vsA)} | ≥ +5 | ${ahead ? 'PASS' : 'FAIL'} |`,
    '',
    `**Decision: ${nonInferior && ahead ? 'SHIP the chosen setting' : 'NO SHIP'}.** Frozen setting ` +
      `(greedy on all cases): ${formatOverrides(frozen.chosen)}.`,
    frozen.chosen.exclusionMode === 'conflictsOnly'
      ? 'No scored exclusion mode beat conflicts-only on the training folds: per protocol, excluded ' +
        'terms are shown as conflicts and not scored.'
      : '',
    '',
    ...foldRows(folds),
    '',
    ...table('non-cited (primary)', clean),
    ...table(
      'cited (secondary)',
      cases.filter((c) => c.cited)
    ),
    ...table('all cases', cases),
    `Chosen-setting scoring per case (all genes, index in memory): median ${quantile(ms, 0.5).toFixed(1)} ms, ` +
      `p95 ${quantile(ms, 0.95).toFixed(1)} ms.`,
    '',
    '### Greedy path on all cases (frozen setting; in-sample, descriptive)',
    '',
    ...stepRows,
    ...renderSensitivity(cases, sensitivity)
  ].join('\n')
}

function main(argv: string[]): void {
  const release = argv.includes('--release') ? argv[argv.indexOf('--release') + 1] : undefined
  if (release === undefined || !/^[\w.-]+$/.test(release)) throw new Error('--release <tag>')
  const { outDir } = runArgs(argv)
  const sample = argv.includes('--sample') ? Number(argv[argv.indexOf('--sample') + 1]) : Infinity
  const storeDir = join(DATA_DIR, 'external', 'phenopacket-store', release)
  const hpoa = readFileSync(join(HPO_RAW_DIR, 'phenotype.hpoa'), 'utf8')
  const g2p = readFileSync(join(HPO_RAW_DIR, 'genes_to_phenotype.txt'), 'utf8')
  const genes = [...parseGenesToPhenotype(g2p, parseHpoaDiseaseTerms(hpoa)).keys()].sort()
  const geneIndex = new Map(genes.map((g, i) => [g, i]))
  const refs = hpoaReferences(hpoa)
  const geneDiseases = new Map<string, string[]>()
  for (const d of parseDiseases(hpoa, g2p))
    for (const g of d.genes) geneDiseases.set(g, [...(geneDiseases.get(g) ?? []), d.id])
  const s3 = buildHpoIndex(readSprint3Input(HPO_DB_SPRINT3))
  // One index per τ: the stored background null is τ-specific (build-tau-dbs.ts).
  const ixs = new Map<number, PhenotypeIndex>(
    EXTERNAL_TAUS.map((tau) => {
      const ix = loadPhenotypeIndex(hpoDbForTau(tau))
      if (ix === null) throw new Error(`${hpoDbForTau(tau)} needs an update`)
      return [tau, ix]
    })
  )
  const ix0 = ixs.get(HPO_SCORING_CONFIG.tau)!
  const map = Int32Array.from(genes, (g) => ix0.genes.get(g) ?? -1)
  // A profile without a known present term scores nothing: every gene ties (a miss, not a skip).
  const v2 = (terms: HpoProfileTerm[], o: Overrides): Float64Array => {
    const r = scoreCase(ixs.get(Number(o.tau ?? HPO_SCORING_CONFIG.tau))!, terms, o)
    return Float64Array.from(map, (g) =>
      r === null || g < 0 || r.geneBest[g] < 0 ? -Infinity : r.geneScore[g]
    )
  }

  const raw = [...jsonFiles(join(storeDir, 'extracted'))]
    .sort()
    .map((f) => parsePhenopacket(JSON.parse(readFileSync(f, 'utf8'))))
    .flatMap((c) => (c === null || !geneIndex.has(c.gene) ? [] : [c]))
    .filter((_, i, all) => i % Math.max(1, Math.ceil(all.length / sample)) === 0)
  const foldOf = geneFolds(
    raw.map((c) => c.gene),
    FOLDS,
    SEED
  )
  // Sensitivity (b): genes sharing a disease (diagnosed or annotated) or a publication share a fold.
  const componentOf = componentFolds(
    raw.flatMap((c) =>
      [...c.diseases, ...(geneDiseases.get(c.gene) ?? []), ...c.pmids].map(
        (n) => [c.gene, n] as const
      )
    ),
    FOLDS
  )
  const items = raw.map((c) => {
    const present = c.observed.map((hpoId) => ({ hpoId, excluded: false, key: false }))
    const absent = c.excluded.map((hpoId) => ({ hpoId, excluded: true, key: false }))
    const s = scoreAllGenes(s3, c.observed)
    const sprint3 = Float64Array.from(genes, (g) => {
      const i = s3.genes.get(g)
      return s === null || i === undefined ? -Infinity : s[i]
    })
    const causal = geneIndex.get(c.gene)!
    return {
      c,
      causal,
      present,
      full: [...present, ...absent],
      fold: foldOf.get(c.gene)!,
      sprint3: standing(sprint3, causal),
      v2Present: standing(v2(present, ORIGINAL_V2), causal)
    }
  })
  if (items.length === 0) throw new Error('no cases')
  console.log(`${items.length} cases`)

  const memo = new Map<string, Int32Array>()
  const standings = (o: Overrides): Int32Array => {
    const key = JSON.stringify(Object.entries(o).sort())
    const hit = memo.get(key)
    if (hit !== undefined) return hit
    const st = new Int32Array(2 * items.length)
    items.forEach((it, i) => {
      const s = standing(v2(it.full, o), it.causal)
      st[2 * i] = s.higher
      st[2 * i + 1] = s.equal
    })
    memo.set(key, st)
    console.log(`setting ${memo.size}: ${key}`)
    return st
  }
  const hit10 = (o: Overrides, subset: number[]): number => {
    const st = standings(o)
    return mean(subset.map((i) => tieAveragedHit(st[2 * i], st[2 * i + 1], 10)))
  }
  const at = (o: Overrides, i: number): Standing => {
    const st = standings(o)
    return { higher: st[2 * i], equal: st[2 * i + 1] }
  }
  const search = (subset: number[], steps: TuneStep[] = EXTERNAL_STEPS): GreedyResult =>
    greedy(steps, (o) => hit10(o, subset), ORIGINAL_V2)
  const idx = items.map((_, i) => i)
  const nested = (fold: (i: number) => number, steps?: TuneStep[]): GreedyResult[] =>
    Array.from({ length: FOLDS }, (_, f) =>
      search(
        idx.filter((i) => fold(i) !== f),
        steps
      )
    )
  const folds = nested((i) => items[i].fold)
  const compOf = (i: number): number => componentOf.get(items[i].c.gene)!
  const compFolds = nested(compOf)
  const jointFolds = nested((i) => items[i].fold, EXTERNAL_JOINT)
  const cases: TuneCase[] = items.map((it, i) => {
    const o = folds[it.fold].chosen
    const t0 = performance.now()
    const tuned = standing(v2(it.full, o), it.causal)
    const ms = performance.now() - t0
    return {
      gene: it.c.gene,
      cited: citedByHpoa(it.c, refs),
      citedGene: citedByHpoa(it.c, refs, [
        ...it.c.diseases,
        ...(geneDiseases.get(it.c.gene) ?? [])
      ]),
      fold: it.fold,
      ms,
      scorers: {
        sprint3: it.sprint3,
        v2Present: it.v2Present,
        tunedPresent: standing(v2(it.present, o), it.causal),
        tuned,
        shipped: at(SHIPPED, i),
        tunedComponent: at(compFolds[compOf(i)].chosen, i),
        tunedJoint: at(jointFolds[it.fold].chosen, i)
      }
    }
  })
  const frozen = search(idx)
  const nonCited = idx.filter((i) => !cases[i].cited)
  const nonCitedGene = idx.filter((i) => !cases[i].citedGene)
  const sensitivity: Sensitivity = {
    componentFolds: compFolds,
    componentSizes: Array.from(
      { length: FOLDS },
      (_, f) => [...componentOf.values()].filter((x) => x === f).length
    ),
    jointFolds,
    tauRows: EXTERNAL_TAUS.map((tau) => {
      const o = { ...SHIPPED, tau }
      return {
        tau,
        all: hit10(o, idx),
        nonCited: hit10(o, nonCited),
        nonCitedGene: hit10(o, nonCitedGene)
      }
    })
  }
  writeFileSync(
    join(outDir, 'external-tuning.md'),
    render(cases, folds, frozen, sensitivity) + '\n'
  )
  writeFileSync(join(outDir, 'cases.json'), JSON.stringify(cases) + '\n')
  writeFileSync(
    join(outDir, 'tuning.json'),
    JSON.stringify({ folds, frozen, compFolds, jointFolds }) + '\n'
  )
  console.log(`wrote ${join(outDir, 'external-tuning.md')} (${memo.size} settings scored)`)
}

main(process.argv.slice(2))
