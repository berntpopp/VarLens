/**
 * Shared setup of the HPO scoring v2 benchmark (#600): verified HPO release files, gene universe,
 * gene-grouped folds, the frozen sprint-3 baseline and the simulated E0/E1/E2 profiles. Used by
 * gene-ranking.ts (spec defaults) and tune.ts (nested cross-validated tuning).
 */
import Database from 'better-sqlite3-multiple-ciphers'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ancestorClosure,
  parseGenesToPhenotype,
  parseHpJson,
  parseHpoaDiseaseTerms
} from '../../../src/shared/phenotype/hpo-sources'
import type { HpoProfileTerm } from '../../../src/shared/types/hpo-profile'
import { assertOutsideRepo, HPO_DB_SPRINT3, HPO_RAW_DIR, RUNS_DIR } from '../common/paths'
import { rng } from '../common/rng'
import { componentFolds } from '../stats/folds'
import { ARM_CONFIG, ARMS, armProfile, drawArms, topMimics } from './arms'
import {
  averageRanks,
  spearman,
  TOP_RHO_GENES,
  topSpearman,
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

export const SEED = 20261014
/** Pre-registered gene-grouped folds (spec §5). */
export const FOLDS = 5
/** Diseases sampled: the sprint-3 run's 1,000 (Hit@10 CIs ≈ ±3 pp). */
const DEFAULT_DISEASES = 1000

/** `--run <name> [--diseases N]` → the run's output directory (outside the repo) and sample size. */
export function runArgs(argv: string[]): { outDir: string; nDiseases: number } {
  const arg = (n: string): string | undefined => argv[argv.indexOf(n) + 1]
  const run = argv.includes('--run') ? arg('--run') : undefined
  if (run === undefined || !/^[\w.-]+$/.test(run)) throw new Error('--run <name> is required')
  const nDiseases = Number(argv.includes('--diseases') ? arg('--diseases') : DEFAULT_DISEASES)
  if (!Number.isInteger(nDiseases) || nDiseases < 1) throw new Error('--diseases must be ≥ 1')
  const outDir = assertOutsideRepo(join(RUNS_DIR, run))
  mkdirSync(outDir, { recursive: true })
  return { outDir, nDiseases }
}

/** One simulated case before the scorer under test runs. */
export interface BenchProfile {
  terms: HpoProfileTerm[]
  /** Causal gene index into the gene universe. */
  causal: number
  baseline: Standing
  meta: Omit<GeneRankCase, 'ms' | 'scorers'>
}

/** Raw release files, refused unless they are the bytes the baseline DB was built from. */
export function readVerifiedSources(): {
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
export function standing(scores: Float64Array, causal: number): { higher: number; equal: number } {
  let higher = 0
  let equal = 0
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] > scores[causal]) higher++
    else if (i !== causal && scores[i] === scores[causal]) equal++
  }
  return { higher, equal }
}

/** Gene universe, folds, the frozen baseline and the per-disease case builder. */
export function setupBench(src: ReturnType<typeof readVerifiedSources>) {
  const hp = parseHpJson(src.ontology)
  const ancestors = ancestorClosure(hp)
  const geneTerms = parseGenesToPhenotype(src.genes, parseHpoaDiseaseTerms(src.annotations))
  const genes = [...geneTerms.keys()].sort()
  const geneIndex = new Map(genes.map((g, i) => [g, i]))
  const all = parseDiseases(src.annotations, src.genes)
  const geneDiseases = new Map<string, Set<string>>()
  for (const d of all)
    for (const g of d.genes) geneDiseases.set(g, (geneDiseases.get(g) ?? new Set()).add(d.id))
  const termCounts = Float64Array.from(genes, (g) => geneTerms.get(g)?.size ?? 0)
  const termRanks = averageRanks(termCounts)
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
    rhoDiseases: spearman(scores, diseaseRanks),
    rhoTop100: topSpearman(scores, termCounts, TOP_RHO_GENES)
  })

  /** Every level × arm profile of one disease, with the frozen sprint-3 standing. */
  function profilesFor(disease: Disease): BenchProfile[] {
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
    const out: BenchProfile[] = []
    for (const level of Object.keys(NOISE_LEVELS) as NoiseLevelId[]) {
      const sampled = sampleProfile(disease, NOISE_LEVELS[level], profiles, rng(seed))
      // Sprint 3 sees present terms only, which are the same in every arm.
      const baseline = rate(sprint3([...new Set([...sampled.reported, ...sampled.noise])]), causal)
      for (const arm of ARMS) {
        const terms = armProfile(arm, sampled, draw, level)
        out.push({
          terms,
          causal,
          baseline,
          meta: {
            disease: disease.id,
            level,
            arm,
            fold: folds.get(causalGene) ?? -1,
            geneDiseases: own.size,
            geneTerms: termCounts[causal],
            present: terms.filter((t) => !t.excluded).length,
            excluded: terms.filter((t) => t.excluded).length,
            keys: terms.filter((t) => t.key).length,
            falseExclusion:
              arm === 'E2' && terms.some((t) => t.excluded && t.hpoId === draw.falseExclusion),
            noiseKey: arm === 'E2' && terms.some((t) => t.key && sampled.noise.includes(t.hpoId))
          }
        })
      }
    }
    return out
  }
  const foldGenes = Array.from(
    { length: FOLDS },
    (_, f) => [...folds.values()].filter((x) => x === f).length
  )
  return { all, genes, foldGenes, profilesFor, rate }
}
