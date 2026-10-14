/**
 * Nested cross-validated tuning of the v2 phenotype scorer on phenopacket-store (#600), following
 * the pre-registered protocol `.planning/artifacts/shortlist-sim/2026-10-14-hpo-v2/external-tuning.md`:
 *
 *   npx jiti scripts/shortlist-sim/phenotype/tune-external.ts --release <tag> --run <name>
 *
 * Cases as in external-phenopackets.ts. Every setting is scored through the production scorer
 * (`scoreCase` with option overrides); standings are computed once per setting over all cases
 * and shared by every fold. Writes runs/<name>/{cases.json, tuning.json, external-tuning.md}.
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
import { geneFolds } from '../stats/folds'
import { mean, tieAveragedHit, tieAveragedReciprocal } from '../stats/metrics'
import { runArgs, standing } from './bench-setup'
import { citedByHpoa, hpoaReferences, jsonFiles, parsePhenopacket } from './phenopackets'
import { buildHpoIndex, readSprint3Input, scoreAllGenes } from './sprint3-baseline'
import {
  EXTERNAL_STEPS,
  EXTERNAL_TAUS,
  formatOverrides,
  greedy,
  type GreedyResult,
  type Overrides
} from './tuning'

const FOLDS = 5
const SEED = 20261017
const REPS = 2000
/** Primary ship rule (protocol): non-inferior to v2 observed-only, and ahead of sprint 3. */
const RULE = { minDelta: 0, minLower: -0.02, minVsSprint3: 0.05 } as const

type Standing = { higher: number; equal: number }
const SCORERS = ['sprint3', 'v2Present', 'tunedPresent', 'tuned'] as const
type ScorerId = (typeof SCORERS)[number]
const LABELS: Record<ScorerId, string> = {
  sprint3: '(a) sprint 3, observed',
  v2Present: '(b) v2 defaults, observed',
  tunedPresent: '(b′) chosen setting, observed',
  tuned: '(t) chosen setting, observed + excluded'
}

interface TuneCase {
  gene: string
  cited: boolean
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

function render(cases: TuneCase[], folds: GreedyResult[], frozen: GreedyResult): string {
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
    '',
    '| Outer fold | chosen on the other four | training Hit@10 % |',
    '|---|---|---|',
    ...folds.map(
      (f, i) => `| ${i} | ${formatOverrides(f.chosen)} | ${(100 * f.objective).toFixed(1)} |`
    ),
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
    ...stepRows
  ].join('\n')
}

function main(argv: string[]): void {
  const release = argv.includes('--release') ? argv[argv.indexOf('--release') + 1] : undefined
  if (release === undefined || !/^[\w.-]+$/.test(release)) throw new Error('--release <tag>')
  const { outDir } = runArgs(argv)
  const storeDir = join(DATA_DIR, 'external', 'phenopacket-store', release)
  const hpoa = readFileSync(join(HPO_RAW_DIR, 'phenotype.hpoa'), 'utf8')
  const g2p = readFileSync(join(HPO_RAW_DIR, 'genes_to_phenotype.txt'), 'utf8')
  const genes = [...parseGenesToPhenotype(g2p, parseHpoaDiseaseTerms(hpoa)).keys()].sort()
  const geneIndex = new Map(genes.map((g, i) => [g, i]))
  const refs = hpoaReferences(hpoa)
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
  const foldOf = geneFolds(
    raw.map((c) => c.gene),
    FOLDS,
    SEED
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
      v2Present: standing(v2(present, {}), causal)
    }
  })
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
  const search = (subset: number[]): GreedyResult =>
    greedy(EXTERNAL_STEPS, (o) => {
      const st = standings(o)
      return mean(subset.map((i) => tieAveragedHit(st[2 * i], st[2 * i + 1], 10)))
    })
  const idx = items.map((_, i) => i)
  const folds = Array.from({ length: FOLDS }, (_, f) =>
    search(idx.filter((i) => items[i].fold !== f))
  )
  const cases: TuneCase[] = items.map((it) => {
    const o = folds[it.fold].chosen
    const t0 = performance.now()
    const tuned = standing(v2(it.full, o), it.causal)
    const ms = performance.now() - t0
    return {
      gene: it.c.gene,
      cited: citedByHpoa(it.c, refs),
      fold: it.fold,
      ms,
      scorers: {
        sprint3: it.sprint3,
        v2Present: it.v2Present,
        tunedPresent: standing(v2(it.present, o), it.causal),
        tuned
      }
    }
  })
  const frozen = search(idx)
  writeFileSync(join(outDir, 'external-tuning.md'), render(cases, folds, frozen) + '\n')
  writeFileSync(join(outDir, 'cases.json'), JSON.stringify(cases) + '\n')
  writeFileSync(join(outDir, 'tuning.json'), JSON.stringify({ folds, frozen }) + '\n')
  console.log(`wrote ${join(outDir, 'external-tuning.md')} (${memo.size} settings scored)`)
}

main(process.argv.slice(2))
