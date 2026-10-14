/**
 * Micro-benchmark of the phenotype scorer v2 (spec §3 performance budget). Not a test.
 * The sprint-3 comparison lives in scripts/shortlist-sim/phenotype/sprint3-baseline.ts.
 *
 * Usage: npx jiti scripts/perf/hpo-scorer-bench.ts --db <hpo_similarity.db> [--raw <dir with
 *   hp.json, phenotype.hpoa, genes_to_phenotype.txt>]   (builds --db from --raw when given)
 * Keep --db outside the repository (private data cache).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { performance } from 'node:perf_hooks'
import {
  buildHpoSimilarityDb,
  loadPhenotypeIndex,
  openHpoGeneScorer
} from '../../src/main/services/phenotype/hpo-similarity-db'
import { scoreCase } from '../../src/shared/phenotype/phenotype-score'
import type { HpoProfileTerm } from '../../src/shared/types/hpo-profile'

const { values } = parseArgs({ options: { db: { type: 'string' }, raw: { type: 'string' } } })
if (values.db === undefined) throw new Error('--db is required')
const dbPath = values.db

if (values.raw !== undefined) {
  const read = (f: string): string => readFileSync(join(values.raw!, f), 'utf8')
  const t0 = performance.now()
  buildHpoSimilarityDb(
    {
      ontology: read('hp.json'),
      annotations: read('phenotype.hpoa'),
      genes: read('genes_to_phenotype.txt')
    },
    { release: 'bench', sha256: {} },
    dbPath
  )
  console.log(`build: ${(performance.now() - t0).toFixed(0)} ms`)
}

const rssBefore = process.memoryUsage().rss
const t0 = performance.now()
const ix = loadPhenotypeIndex(dbPath)!
const loadMs = performance.now() - t0
const rssMb = (process.memoryUsage().rss - rssBefore) / 2 ** 20
console.log(
  `index: ${ix.hpo.ids.length} terms, ${ix.diseaseIds.length} diseases, ${ix.annTerm.length} annotations, ` +
    `${ix.genes.size} genes; load ${loadMs.toFixed(0)} ms, +${rssMb.toFixed(0)} MB RSS`
)

let seed = 42
const rand = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000
const pick = <V>(xs: ArrayLike<V>): V => xs[Math.floor(rand() * xs.length)]

/** Present terms from one disease's annotations (plus noise), excluded terms random. */
function profile(k: number, excluded: number): HpoProfileTerm[] {
  const d = Math.floor(rand() * ix.diseaseIds.length)
  const from = ix.diseaseOffsets[d]
  const to = ix.diseaseOffsets[d + 1]
  const terms: HpoProfileTerm[] = []
  for (let i = 0; i < k; i++) {
    const t =
      to > from && rand() < 0.7
        ? ix.annTerm[from + Math.floor(rand() * (to - from))]
        : pick(ix.annTerm)
    terms.push({ hpoId: ix.hpo.ids[t], excluded: false, key: i === 0 })
  }
  for (let i = 0; i < excluded; i++)
    terms.push({ hpoId: ix.hpo.ids[pick(ix.annTerm)], excluded: true, key: false })
  return terms
}

const quantile = (xs: number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]
}

const RUNS = 60
console.log('| k⁺ | excluded | median ms | p95 ms |')
console.log('|---:|---:|---:|---:|')
for (const k of [1, 5, 10, 20, 50]) {
  for (const excl of [0, 3, 10]) {
    const times: number[] = []
    for (let r = 0; r < RUNS + 5; r++) {
      const p = profile(k, excl)
      const t = performance.now()
      scoreCase(ix, p)
      if (r >= 5) times.push(performance.now() - t)
    }
    const [median, p95] = [quantile(times, 0.5), quantile(times, 0.95)]
    console.log(`| ${k} | ${excl} | ${median.toFixed(2)} | ${p95.toFixed(2)} |`)
  }
}

// Memoised hit: the same profile through the public API twice.
const p = profile(20, 3)
openHpoGeneScorer(p, dbPath)
const hits: number[] = []
for (let r = 0; r < 50; r++) {
  const t = performance.now()
  openHpoGeneScorer(p, dbPath)
  hits.push(performance.now() - t)
}
const scorer = openHpoGeneScorer(p, dbPath)!
const genes = [...ix.genes.keys()].slice(0, 100)
const t = performance.now()
for (const g of genes) scorer.explain(g)
console.log(
  `memoised open: median ${quantile(hits, 0.5).toFixed(3)} ms; explain 100 genes (cold lanes): ` +
    `${(performance.now() - t).toFixed(2)} ms`
)
