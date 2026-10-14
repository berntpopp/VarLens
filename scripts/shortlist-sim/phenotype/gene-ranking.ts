/**
 * Public-data gene-ranking benchmark for hpo_resnik (#600):
 *
 *   npx jiti scripts/shortlist-sim/phenotype/gene-ranking.ts --run <name> [--diseases N]
 *
 * One simulated profile per sampled HPO disease and noise level; every gene in
 * genes_to_phenotype.txt (positive annotations) is scored with the production scorer
 * (`openHpoGeneScorer` on the built hpo_similarity.db) and an exact-overlap reference baseline.
 * `--before <run>` adds that earlier run's rows (same seed → same diseases and profiles).
 * Writes runs/<name>/{cases.json, gene-ranking.md}. Needs `npm run rebuild:node`.
 */
import Database from 'better-sqlite3-multiple-ciphers'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openHpoGeneScorer } from '../../../src/main/services/phenotype/hpo-similarity-db'
import {
  ancestorClosure,
  parseGenesToPhenotype,
  parseHpJson,
  parseHpoaDiseaseTerms
} from '../../../src/shared/phenotype/hpo-sources'
import { assertOutsideRepo, HPO_DB, HPO_RAW_DIR, RUNS_DIR } from '../common/paths'
import { rng, shuffle } from '../common/rng'
import {
  averageRanks,
  renderGeneRanking,
  SCORERS,
  spearman,
  type GeneRankCase,
  type ScorerId
} from './gene-ranking-report'
import {
  diseaseSeed,
  generateProfile,
  NOISE_LEVELS,
  parseDiseases,
  profileOntology,
  type NoiseLevelId
} from './profiles'

const SEED = 20261014
/** Diseases sampled: ~15 min under heavy.sh (it blocks other lanes); Hit@10 CIs stay ≈ ±3 pp. */
const DEFAULT_DISEASES = 1000

/** Raw release files, refused unless they are the bytes the DB was built from. */
function readVerifiedSources(): {
  ontology: string
  annotations: string
  genes: string
  release: string
} {
  const db = new Database(HPO_DB, { readonly: true, fileMustExist: true })
  const meta = new Map(
    (db.prepare('SELECT key, value FROM meta').all() as Array<{ key: string; value: string }>).map(
      (r) => [r.key, r.value]
    )
  )
  db.close()
  const digests = JSON.parse(meta.get('sources_sha256') ?? '{}') as Record<string, string>
  const read = (name: string): string => {
    const bytes = readFileSync(join(HPO_RAW_DIR, name))
    if (createHash('sha256').update(bytes).digest('hex') !== digests[name])
      throw new Error(`${name} in ${HPO_RAW_DIR} is not the release ${HPO_DB} was built from`)
    return bytes.toString('utf8')
  }
  return {
    ontology: read('hp.json'),
    annotations: read('phenotype.hpoa'),
    genes: read('genes_to_phenotype.txt'),
    release: meta.get('hpo_version') ?? 'unknown'
  }
}

/** Causal-gene standing: genes scored strictly higher, and other genes tied with it. */
function standing(scores: Float64Array, causal: number): { higher: number; equal: number } {
  let higher = 0
  let equal = 0
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] > scores[causal]) higher++
    else if (i !== causal && scores[i] === scores[causal]) equal++
  }
  return { higher, equal }
}

function main(argv: string[]): void {
  const arg = (n: string): string | undefined => argv[argv.indexOf(n) + 1]
  const run = argv.includes('--run') ? arg('--run') : undefined
  if (run === undefined || !/^[\w.-]+$/.test(run)) throw new Error('--run <name> is required')
  const nDiseases = Number(argv.includes('--diseases') ? arg('--diseases') : DEFAULT_DISEASES)
  if (!Number.isInteger(nDiseases) || nDiseases < 1) throw new Error('--diseases must be ≥ 1')
  const outDir = assertOutsideRepo(join(RUNS_DIR, run))
  mkdirSync(outDir, { recursive: true })

  const src = readVerifiedSources()
  const hp = parseHpJson(src.ontology)
  const ancestors = ancestorClosure(hp)
  const geneTerms = parseGenesToPhenotype(src.genes, parseHpoaDiseaseTerms(src.annotations))
  const genes = [...geneTerms.keys()].sort()
  const geneIndex = new Map(genes.map((g, i) => [g, i]))
  const termLists = genes.map((g) => [...(geneTerms.get(g) ?? [])])
  const annotationRanks = averageRanks(Float64Array.from(termLists, (t) => t.length))
  const profiles = profileOntology(hp, ancestors)
  const all = parseDiseases(src.annotations, src.genes)
  const diseases = shuffle(all, rng(SEED)).slice(0, nDiseases)
  console.log(
    `${src.release}: ${all.length} diseases, ${genes.length} genes; sampling ${diseases.length}`
  )

  const cases: GeneRankCase[] = []
  const n = genes.length
  for (const [di, disease] of diseases.entries()) {
    const seed = diseaseSeed(disease.id, SEED)
    const causalGene = disease.genes[Math.floor(rng(seed ^ 0x9e3779b9)() * disease.genes.length)]
    const causal = geneIndex.get(causalGene)
    if (causal === undefined) throw new Error(`${causalGene} missing from genes_to_phenotype`)
    for (const level of Object.keys(NOISE_LEVELS) as NoiseLevelId[]) {
      const profile = generateProfile(disease, NOISE_LEVELS[level], profiles, rng(seed))
      const t0 = performance.now()
      const scorer = openHpoGeneScorer(profile, HPO_DB)
      if (scorer === null) throw new Error(`no scorer for ${disease.id}`)
      const resnik = Float64Array.from(genes, (g) => scorer.score(g) ?? -Infinity)
      scorer.close()
      const ms = performance.now() - t0
      const profileSet = new Set(profile)
      const byScorer: Record<ScorerId, Float64Array> = {
        resnik,
        overlap: Float64Array.from(termLists, (t) => t.filter((x) => profileSet.has(x)).length)
      }
      cases.push({
        disease: disease.id,
        level,
        profileSize: profile.length,
        ms,
        scorers: Object.fromEntries(
          SCORERS.map((s) => [
            s,
            { ...standing(byScorer[s], causal), rho: spearman(byScorer[s], annotationRanks) }
          ])
        ) as GeneRankCase['scorers']
      })
    }
    if ((di + 1) % 100 === 0) console.log(`${di + 1}/${diseases.length} diseases`)
  }
  const sampled = new Set(diseases.map((d) => d.id))
  const beforeRun = argv.includes('--before') ? arg('--before') : undefined
  const before =
    beforeRun === undefined
      ? undefined
      : (
          JSON.parse(
            readFileSync(join(RUNS_DIR, beforeRun, 'cases.json'), 'utf8')
          ) as GeneRankCase[]
        ).filter((c) => sampled.has(c.disease))
  const md = renderGeneRanking(
    cases,
    {
      release: src.release,
      diseases: diseases.length,
      eligible: all.length,
      genes: n
    },
    before
  )
  writeFileSync(join(outDir, 'gene-ranking.md'), md)
  writeFileSync(join(outDir, 'cases.json'), JSON.stringify(cases) + '\n')
  console.log(`wrote ${join(outDir, 'gene-ranking.md')}`)
}

main(process.argv.slice(2))
