/**
 * External real-patient benchmark of the HPO scorer (#600) on GA4GH phenopacket-store:
 *
 *   npx jiti scripts/shortlist-sim/phenotype/external-phenopackets.ts --release <tag> --run <name>
 *
 * Expects the release's all_phenopackets.zip unpacked under
 * DATA_DIR/external/phenopacket-store/<tag>/extracted (outside the repository). Per published
 * single-gene case the diagnosed gene is ranked among every gene of genes_to_phenotype.txt by
 * (a) the frozen sprint-3 scorer, (b) v2 on the observed terms, (c) v2 on observed + excluded.
 * Writes runs/<name>/{cases.json, external-phenopackets.md}. Needs `npm run rebuild:node`.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openHpoGeneScorer } from '../../../src/main/services/phenotype/hpo-similarity-db'
import {
  parseGenesToPhenotype,
  parseHpoaDiseaseTerms
} from '../../../src/shared/phenotype/hpo-sources'
import type { HpoProfileTerm } from '../../../src/shared/types/hpo-profile'
import { clusterBootstrap, type Interval } from '../stats/bootstrap'
import { mean, median, tieAveragedHit, tieAveragedReciprocal } from '../stats/metrics'
import {
  assertOutsideRepo,
  DATA_DIR,
  HPO_DB,
  HPO_DB_SPRINT3,
  HPO_RAW_DIR,
  RUNS_DIR
} from '../common/paths'
import { citedByHpoa, hpoaReferences, parsePhenopacket } from './phenopackets'
import { buildHpoIndex, readSprint3Input, scoreAllGenes } from './sprint3-baseline'

const SCORERS = ['sprint3', 'v2Present', 'v2Full'] as const
type ScorerId = (typeof SCORERS)[number]
const LABELS: Record<ScorerId, string> = {
  sprint3: '(a) sprint 3, observed',
  v2Present: '(b) v2, observed',
  v2Full: '(c) v2, observed + excluded'
}
const REPS = 2000
const SEED = 20261016
/** Excluded-term strata (pre-registered in the task: 0, 1–3, ≥ 4). */
const EXCLUDED_STRATA: Array<[string, (n: number) => boolean]> = [
  ['0 excluded', (n) => n === 0],
  ['1–3 excluded', (n) => n >= 1 && n <= 3],
  ['≥ 4 excluded', (n) => n >= 4]
]

interface Standing {
  higher: number
  equal: number
}

interface ExternalCase {
  gene: string
  /** The case's publication is cited by HPOA for its disease (annotation leakage risk). */
  cited: boolean
  observed: number
  excluded: number
  /** (c): excluded terms the causal gene's best disease annotates (conflicts), null if unscored. */
  conflicts: number | null
  scorers: Record<ScorerId, Standing>
}

function standing(scores: Float64Array, causal: number): Standing {
  let higher = 0
  let equal = 0
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] > scores[causal]) higher++
    else if (i !== causal && scores[i] === scores[causal]) equal++
  }
  return { higher, equal }
}

function* jsonFiles(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, e.name)
    if (e.isDirectory()) yield* jsonFiles(path)
    else if (e.name.endsWith('.json')) yield path
  }
}

type Stat = (cs: ExternalCase[], s: ScorerId) => number
const hit =
  (k: number): Stat =>
  (cs, s) =>
    mean(cs.map((c) => tieAveragedHit(c.scorers[s].higher, c.scorers[s].equal, k)))
const mrr: Stat = (cs, s) =>
  mean(cs.map((c) => tieAveragedReciprocal(c.scorers[s].higher, c.scorers[s].equal)))
const medianRank: Stat = (cs, s) =>
  median(cs.map((c) => c.scorers[s].higher + 1 + c.scorers[s].equal / 2))

const byGene = (c: ExternalCase): string => c.gene
const pct = (i: Interval): string =>
  `${(100 * i.estimate).toFixed(1)} [${(100 * i.lo).toFixed(1)}, ${(100 * i.hi).toFixed(1)}]`
const num = (i: Interval, d: number): string =>
  `${i.estimate.toFixed(d)} [${i.lo.toFixed(d)}, ${i.hi.toFixed(d)}]`

/** Paired stat(a) − stat(b) on the same cases, gene-clustered. */
function delta(cs: ExternalCase[], a: ScorerId, b: ScorerId, stat: Stat): Interval {
  // One case set scored twice: resample cases by gene, take the difference within each resample.
  return clusterBootstrap(cs, byGene, (xs) => stat(xs, a) - stat(xs, b), REPS, SEED)
}

const withExcl = (cs: ExternalCase[]): ExternalCase[] => cs.filter((c) => c.excluded > 0)
const share = (cs: ExternalCase[]): string => {
  const xs = withExcl(cs)
  return `${((100 * xs.filter((c) => (c.conflicts ?? 0) > 0).length) / xs.length).toFixed(1)} %`
}

function table(title: string, cs: ExternalCase[]): string[] {
  const genes = new Set(cs.map(byGene)).size
  const head = `### ${title} (${cs.length} cases, ${genes} genes; median ${median(cs.map((c) => c.observed))} observed, ${median(cs.map((c) => c.excluded))} excluded)`
  if (cs.length === 0) return [head, '', 'No cases.', '']
  const boot = (s: ScorerId, stat: Stat): Interval =>
    clusterBootstrap(cs, byGene, (x) => stat(x, s), REPS, SEED)
  const row = (s: ScorerId): string =>
    `| ${LABELS[s]} | ${[1, 10, 50].map((k) => pct(boot(s, hit(k)))).join(' | ')} | ` +
    `${num(boot(s, medianRank), 1)} | ${num(boot(s, mrr), 3)} |`
  const d = (a: ScorerId, b: ScorerId): string =>
    `Hit@10 ${pct(delta(cs, a, b, hit(10)))} pp, MRR ${num(delta(cs, a, b, mrr), 3)}`
  return [
    head,
    '',
    '| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | median rank | MRR |',
    '|---|---|---|---|---|---|',
    ...SCORERS.map(row),
    '',
    `Paired Δ (c) − (b), effect of exclusions: ${d('v2Full', 'v2Present')}.`,
    `Paired Δ (c) − (a), v2 vs sprint 3: ${d('v2Full', 'sprint3')}.`,
    ...(withExcl(cs).length === 0
      ? []
      : [
          `(c) causal gene's best disease annotates ≥ 1 excluded term in ${share(cs)} of cases ` +
            `with exclusions (median ${median(withExcl(cs).map((c) => c.conflicts ?? 0))} conflicts).`
        ]),
    ''
  ]
}

function renderExternal(
  cases: ExternalCase[],
  info: {
    release: string
    sha256: string
    hpo: string
    files: number
    diseases: number
    dropped: string[]
  }
): string {
  const cited = cases.filter((c) => c.cited)
  const clean = cases.filter((c) => !c.cited)
  const lines = [
    '# HPO phenotype scoring v2: external benchmark on phenopacket-store (#600)',
    '',
    `GA4GH phenopacket-store ${info.release} (all_phenopackets.zip sha256 \`${info.sha256}\`),`,
    `${info.files} phenopackets; HPO release ${info.hpo}. Kept: single-gene diagnoses with ≥ 1`,
    `observed HPO term whose gene is in genes_to_phenotype.txt. Dropped: ${info.dropped.join('; ')}.`,
    `Kept ${cases.length} cases, ${cases.filter((c) => c.excluded > 0).length} with ≥ 1 excluded term,`,
    `${new Set(cases.map(byGene)).size} genes, ${info.diseases} diseases. Each diagnosed gene is ranked among all genes; ranks`,
    `are tie-averaged; intervals are 95 % percentile bootstrap over genes (${REPS} replicates),`,
    'because phenopacket-store holds many cases per gene and publication.',
    '',
    '**Leakage.** HPOA disease annotations are curated partly from the same publications.',
    `${cited.length} of ${cases.length} cases (${((100 * cited.length) / cases.length).toFixed(1)} %)`,
    "come from a PMID that phenotype.hpoa's reference column cites for the case's disease;",
    'their phenotypes may literally be the annotation. The not-cited subset is the cleaner test.',
    '',
    '## All cases',
    '',
    ...table('all', cases),
    '## By leakage',
    '',
    ...table('publication cited by HPOA (overlapping)', cited),
    ...table('publication not cited by HPOA (non-overlapping)', clean),
    '## By number of excluded terms',
    '',
    ...EXCLUDED_STRATA.flatMap(([name, f]) =>
      table(
        name,
        cases.filter((c) => f(c.excluded))
      )
    ),
    '## By number of excluded terms, non-overlapping subset',
    '',
    ...EXCLUDED_STRATA.flatMap(([name, f]) =>
      table(
        name,
        clean.filter((c) => f(c.excluded))
      )
    )
  ]
  return lines.join('\n')
}

function main(argv: string[]): void {
  const arg = (n: string): string | undefined =>
    argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined
  const release = arg('--release')
  const run = arg('--run')
  if (release === undefined || !/^[\w.-]+$/.test(release)) throw new Error('--release <tag>')
  if (run === undefined || !/^[\w.-]+$/.test(run)) throw new Error('--run <name>')
  const storeDir = join(DATA_DIR, 'external', 'phenopacket-store', release)
  const outDir = assertOutsideRepo(join(RUNS_DIR, run))
  mkdirSync(outDir, { recursive: true })
  const sha256 = createHash('sha256')
    .update(readFileSync(join(storeDir, 'all_phenopackets.zip')))
    .digest('hex')

  const hpoa = readFileSync(join(HPO_RAW_DIR, 'phenotype.hpoa'), 'utf8')
  const g2p = readFileSync(join(HPO_RAW_DIR, 'genes_to_phenotype.txt'), 'utf8')
  const genes = [...parseGenesToPhenotype(g2p, parseHpoaDiseaseTerms(hpoa)).keys()].sort()
  const geneIndex = new Map(genes.map((g, i) => [g, i]))
  const refs = hpoaReferences(hpoa)
  const geneIx = buildHpoIndex(readSprint3Input(HPO_DB_SPRINT3))
  const sprint3 = (terms: string[]): Float64Array => {
    const s = scoreAllGenes(geneIx, terms)
    return Float64Array.from(genes, (g) => {
      const i = geneIx.genes.get(g)
      return s === null || i === undefined ? -Infinity : s[i]
    })
  }
  // A profile without a known present term scores nothing: every gene ties (a miss, not a skip).
  const v2 = (terms: HpoProfileTerm[]) => {
    const scorer = openHpoGeneScorer(terms, HPO_DB)
    return { scorer, scores: Float64Array.from(genes, (g) => scorer?.score(g) ?? -Infinity) }
  }

  const files = [...jsonFiles(join(storeDir, 'extracted'))].sort()
  let unparsed = 0
  let unmapped = 0
  const cases: ExternalCase[] = []
  const diseases = new Set<string>()
  for (const [i, file] of files.entries()) {
    const c = parsePhenopacket(JSON.parse(readFileSync(file, 'utf8')))
    const causal = c === null ? undefined : geneIndex.get(c.gene)
    if (c === null) unparsed++
    else if (causal === undefined) unmapped++
    if (c === null || causal === undefined) continue
    c.diseases.forEach((d) => diseases.add(d))
    const present = c.observed.map((hpoId) => ({ hpoId, excluded: false, key: false }))
    const absent = c.excluded.map((hpoId) => ({ hpoId, excluded: true, key: false }))
    const full = v2([...present, ...absent])
    cases.push({
      gene: c.gene,
      cited: citedByHpoa(c, refs),
      observed: c.observed.length,
      excluded: c.excluded.length,
      conflicts: full.scorer?.conflicts(c.gene) ?? null,
      scorers: {
        sprint3: standing(sprint3(c.observed), causal),
        v2Present: standing(v2(present).scores, causal),
        v2Full: standing(full.scores, causal)
      }
    })
    if ((i + 1) % 1000 === 0) console.log(`${i + 1}/${files.length} phenopackets`)
  }
  const md = renderExternal(cases, {
    release,
    sha256,
    hpo: hpoa.match(/^#version: (.+)$/m)?.[1] ?? 'unknown',
    files: files.length,
    diseases: diseases.size,
    dropped: [
      `${unparsed} not single-gene or without an observed HPO term`,
      `${unmapped} gene not in the scorer's gene map`
    ]
  })
  writeFileSync(join(outDir, 'external-phenopackets.md'), md)
  writeFileSync(join(outDir, 'cases.json'), JSON.stringify(cases) + '\n')
  console.log(`wrote ${join(outDir, 'external-phenopackets.md')}`)
}

main(process.argv.slice(2))
