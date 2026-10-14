/**
 * Public-data gene-ranking benchmark for HPO phenotype scoring v2 (#600, spec §5):
 *
 *   npx jiti scripts/shortlist-sim/phenotype/gene-ranking.ts --run <name> [--diseases N]
 *
 * One simulated profile per sampled HPO disease, noise level and arm (E0/E1/E2, arms.ts); every
 * gene in genes_to_phenotype.txt (positive annotations) is scored by the candidate production
 * scorer (`openHpoGeneScorer` on HPO_DB) and the frozen sprint-3 baseline (sprint3-baseline.ts on
 * HPO_DB_SPRINT3), on identical profiles. Same seed and diseases as the sprint-3 run.
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
import type { HpoProfileTerm } from '../../../src/shared/types/hpo-profile'
import { assertOutsideRepo, HPO_DB, HPO_DB_SPRINT3, HPO_RAW_DIR, RUNS_DIR } from '../common/paths'
import { rng, shuffle } from '../common/rng'
import { componentFolds } from '../stats/folds'
import { ARM_CONFIG, ARMS, armProfile, drawArms, topMimics } from './arms'
import {
  averageRanks,
  renderGeneRanking,
  spearman,
  type GeneRankCase,
  type Standing
} from './gene-ranking-report'
import {
  diseaseSeed,
  NOISE_LEVELS,
  parseDiseases,
  profileOntology,
  sampleProfile,
  type Disease,
  type NoiseLevelId
} from './profiles'
import { buildHpoIndex, readSprint3Input, scoreAllGenes } from './sprint3-baseline'

const SEED = 20261014
/** Diseases sampled: the sprint-3 run's 1,000 (Hit@10 CIs ≈ ±3 pp). */
const DEFAULT_DISEASES = 1000
/** Pre-registered gene-grouped folds (spec §5). */
const FOLDS = 5

/**
 * The scorer under test, given the full profile. Until the v2 scorer lands this is the sprint-3
 * production scorer standing in (present terms only, flags ignored).
 * ponytail: swap to `openHpoGeneScorer(terms, HPO_DB)` when the v2 contract is merged.
 */
function openCandidate(terms: HpoProfileTerm[]): ((gene: string) => number | null) | null {
  const present = terms.filter((t) => !t.excluded).map((t) => t.hpoId)
  const scorer = openHpoGeneScorer(present, HPO_DB)
  return scorer === null ? null : (gene) => scorer.score(gene)
}

/** Raw release files, refused unless they are the bytes the baseline DB was built from. */
function readVerifiedSources(): {
  ontology: string
  annotations: string
  genes: string
  release: string
} {
  const db = new Database(HPO_DB_SPRINT3, { readonly: true, fileMustExist: true })
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
      throw new Error(`${name} in ${HPO_RAW_DIR} is not the release of ${HPO_DB_SPRINT3}`)
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

/** Gene universe, folds, the frozen baseline and the per-disease case builder. */
function setup(src: ReturnType<typeof readVerifiedSources>) {
  const hp = parseHpJson(src.ontology)
  const ancestors = ancestorClosure(hp)
  const geneTerms = parseGenesToPhenotype(src.genes, parseHpoaDiseaseTerms(src.annotations))
  const genes = [...geneTerms.keys()].sort()
  const geneIndex = new Map(genes.map((g, i) => [g, i]))
  const all = parseDiseases(src.annotations, src.genes)
  const geneDiseases = new Map<string, Set<string>>()
  for (const d of all)
    for (const g of d.genes) geneDiseases.set(g, (geneDiseases.get(g) ?? new Set()).add(d.id))
  const termRanks = averageRanks(Float64Array.from(genes, (g) => geneTerms.get(g)?.size ?? 0))
  const diseaseRanks = averageRanks(Float64Array.from(genes, (g) => geneDiseases.get(g)?.size ?? 0))
  const folds = componentFolds(
    all.flatMap((d) => d.genes.map((g) => [g, d.id] as const)),
    FOLDS
  )
  const profiles = profileOntology(hp, ancestors)

  // Frozen sprint-3 baseline: the gene index, and the same index over diseases for mimics.
  const input = readSprint3Input(HPO_DB_SPRINT3)
  const geneIx = buildHpoIndex(input)
  const diseaseIx = buildHpoIndex({
    ...input,
    geneTerms: all.flatMap((d) => [...d.terms.keys()].map((t) => [d.id, t] as const))
  })
  const diseaseIds = [...diseaseIx.genes.keys()]
  const byId = new Map(all.map((d) => [d.id, d]))
  const ctx = {
    ancestors,
    ic: (t: string): number => geneIx.ic[geneIx.index.get(t) ?? -1] ?? 0,
    isAbnormality: profiles.isAbnormality
  }
  const sprint3 = (present: string[]): Float64Array => {
    const s = scoreAllGenes(geneIx, present)
    return Float64Array.from(genes, (g) => {
      const i = geneIx.genes.get(g)
      return s === null || i === undefined ? -Infinity : s[i]
    })
  }
  const rate = (scores: Float64Array, causal: number): Standing => ({
    ...standing(scores, causal),
    rho: spearman(scores, termRanks),
    rhoDiseases: spearman(scores, diseaseRanks)
  })

  /** Every level × arm case of one disease; both scorers see identical profiles. */
  function casesFor(disease: Disease): GeneRankCase[] {
    const seed = diseaseSeed(disease.id, SEED)
    const causalGene = disease.genes[Math.floor(rng(seed ^ 0x9e3779b9)() * disease.genes.length)]
    const causal = geneIndex.get(causalGene)
    if (causal === undefined) throw new Error(`${causalGene} missing from genes_to_phenotype`)
    const { truth } = sampleProfile(disease, NOISE_LEVELS.clean, profiles, rng(seed))
    const mimicScores = scoreAllGenes(diseaseIx, truth) ?? new Float64Array(diseaseIds.length)
    const own = geneDiseases.get(causalGene) ?? new Set<string>()
    const mimics = topMimics(mimicScores, diseaseIds, own, ARM_CONFIG.mimics).map((id) =>
      byId.get(id)!
    )
    const draw = drawArms(disease, truth, mimics, ctx, rng(seed ^ ARM_CONFIG.seedSalt))
    const out: GeneRankCase[] = []
    for (const level of Object.keys(NOISE_LEVELS) as NoiseLevelId[]) {
      const sampled = sampleProfile(disease, NOISE_LEVELS[level], profiles, rng(seed))
      // Sprint 3 sees present terms only, which are the same in every arm.
      const baseline = rate(sprint3([...new Set([...sampled.reported, ...sampled.noise])]), causal)
      for (const arm of ARMS) {
        const terms = armProfile(arm, sampled, draw, level)
        const t0 = performance.now()
        const score = openCandidate(terms)
        if (score === null) throw new Error(`no scorer for ${disease.id}`)
        const v2 = Float64Array.from(genes, (g) => score(g) ?? -Infinity)
        const ms = performance.now() - t0
        out.push({
          disease: disease.id,
          level,
          arm,
          fold: folds.get(causalGene) ?? -1,
          geneDiseases: own.size,
          present: terms.filter((t) => !t.excluded).length,
          excluded: terms.filter((t) => t.excluded).length,
          keys: terms.filter((t) => t.key).length,
          falseExclusion:
            arm === 'E2' && terms.some((t) => t.excluded && t.hpoId === draw.falseExclusion),
          noiseKey: arm === 'E2' && terms.some((t) => t.key && sampled.noise.includes(t.hpoId)),
          ms,
          scorers: { v2: rate(v2, causal), sprint3: baseline }
        })
      }
    }
    return out
  }
  const foldGenes = Array.from(
    { length: FOLDS },
    (_, f) => [...folds.values()].filter((x) => x === f).length
  )
  return { all, genes, foldGenes, casesFor }
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
  const { all, genes, foldGenes, casesFor } = setup(src)
  const diseases = shuffle(all, rng(SEED)).slice(0, nDiseases)
  console.log(`${all.length} diseases, ${genes.length} genes; sampling ${diseases.length}`)
  const cases: GeneRankCase[] = []
  for (const [di, disease] of diseases.entries()) {
    cases.push(...casesFor(disease))
    if ((di + 1) % 100 === 0) console.log(`${di + 1}/${diseases.length} diseases`)
  }
  const md = renderGeneRanking(cases, {
    release: src.release,
    diseases: diseases.length,
    eligible: all.length,
    genes: genes.length,
    foldGenes
  })
  writeFileSync(join(outDir, 'gene-ranking.md'), md)
  writeFileSync(join(outDir, 'cases.json'), JSON.stringify(cases) + '\n')
  console.log(`wrote ${join(outDir, 'gene-ranking.md')}`)
}

main(process.argv.slice(2))
