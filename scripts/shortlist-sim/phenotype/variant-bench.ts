/**
 * Variant-level phenotype benchmark (#600, `run.ts --pheno`): every case gets noisy HPO profiles
 * of its spiked disease (one per noise level) as case HPO terms, and the production shortlist
 * ranks it with (a) the tuned varvis template without its phenotype group, (b) the tuned template
 * with varvis `hpo_sim_score`, (c) (a) + `hpo_resnik` bins, fold-tuned or hand-set. The
 * `hpo_resnik` points are tuned on training-fold genes only. Background rows stay in-process;
 * outputs hold ranks, counts and scores of public HPO profiles only.
 */
import { createWriteStream, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openHpoGeneScorer } from '../../../src/main/services/phenotype/hpo-similarity-db'
import { HPO_DATA_CONFIG } from '../../../src/shared/config/hpo-data.config'
import { ancestorClosure, parseHpJson } from '../../../src/shared/phenotype/hpo-sources'
import type { EvidenceRuleset } from '../../../src/shared/types/evidence-ruleset'
import type { ShortlistConfig } from '../../../src/shared/types/shortlist'
import { HPO_DB } from '../common/paths'
import { rng } from '../common/rng'
import type { CaseResult, ScenarioId } from '../common/types'
import type { PoolVariant } from '../pool/select-pool'
import type { SimCase } from '../sim/cases'
import type { Job, JobResult, WorkerInit } from '../sim/jobs'
import { runJobs } from '../sim/pool'
import { evidenceConfig, zeroGroups } from '../sim/scorers'
import { readVerifiedSources } from './hpo-files'
import {
  diseaseSeed,
  generateProfile,
  NOISE_LEVELS,
  parseDiseases,
  profileOntology,
  type NoiseLevelId
} from './profiles'
import {
  RESNIK_BINS,
  RESNIK_HAND_POINTS,
  resnikBin,
  resnikGroup,
  tuneResnikPoints
} from './resnik-group'
import { renderPhenoReport, type Calibration } from './variant-report'

const SEED = 20261014
const LEVELS = Object.keys(NOISE_LEVELS) as NoiseLevelId[]
const SCENARIOS: ScenarioId[] = ['primary', 'clinvar_visible']
const CHUNK = 20
/** Calibration histogram: 0.05-wide score bins up to 10 (max IC ≈ 9.4); last bin = no score. */
const HIST_WIDTH = 0.05
const HIST_BINS = 201

export interface PhenoBenchInput {
  cases: SimCase[]
  folds: Map<string, number>
  k: number
  /** Fold-tuned varvis rulesets (index = test fold). */
  tunedVarvis: EvidenceRuleset[]
  /** Background label → gene → eligible rows (evidence gate, primary scenario). */
  eligible: Map<string, Map<string, number>>
  pool: PoolVariant[]
  init: WorkerInit
  workers: number
  outDir: string
  reps: number
  seed: number
  progress: (label: string) => (done: number, total: number) => void
}

/** Control profile: a moderate profile of a random disease not linked to the causal gene. */
export const SHUFFLED = 'shuffled'

interface PhenoCase {
  c: SimCase
  disease: string
  /** Noise level (or SHUFFLED) → HPO terms. */
  profiles: Record<string, string[]>
}

/** Cases whose spiked disease has HPO annotations: one profile per noise level, plus the control. */
function phenoCases(cases: SimCase[], pool: PoolVariant[]): PhenoCase[] {
  const src = readVerifiedSources()
  const hp = parseHpJson(src.ontology)
  const ont = profileOntology(hp, ancestorClosure(hp))
  const all = parseDiseases(src.annotations, src.genes)
  const diseases = new Map(all.map((d) => [d.id, d]))
  const byKey = new Map(pool.map((v) => [v.key, v]))
  const out: PhenoCase[] = []
  for (const c of cases) {
    const ids = (byKey.get(c.causal[0].poolKey)?.diseaseIds ?? []).filter((id) => diseases.has(id))
    if (ids.length === 0) continue
    const seed = diseaseSeed(c.id, SEED)
    const disease = diseases.get(ids[Math.floor(rng(seed ^ 0x9e3779b9)() * ids.length)])!
    const profiles: Record<string, string[]> = Object.fromEntries(
      LEVELS.map((l) => [l, generateProfile(disease, NOISE_LEVELS[l], ont, rng(seed))])
    )
    const pickOther = rng(seed ^ 0x85ebca6b)
    let other = all[Math.floor(pickOther() * all.length)]
    while (other.genes.includes(c.gene)) other = all[Math.floor(pickOther() * all.length)]
    profiles[SHUFFLED] = generateProfile(other, NOISE_LEVELS.moderate, ont, rng(seed))
    out.push({ c, disease: disease.id, profiles })
  }
  return out
}

interface Scored {
  /** Per level: the causal gene's bin and score. */
  causal: Array<{ bin: number; score: number | null }>
  /** Per level, per gene fold, per bin: eligible background rows. */
  background: number[][][]
}

/** Production scorer per case and level: causal and background bins, plus the calibration data. */
function scoreCases(
  cases: PhenoCase[],
  input: PhenoBenchInput
): { scored: Scored[]; calibration: Calibration; ms: number[] } {
  const hist = LEVELS.map(() => new Array<number>(HIST_BINS).fill(0))
  const causalScores = LEVELS.map((): Array<number | null> => [])
  const ms: number[] = []
  const scored = cases.map(({ c, profiles }) => {
    const eligible = input.eligible.get(c.bg) ?? new Map<string, number>()
    const out: Scored = { causal: [], background: [] }
    LEVELS.forEach((level, li) => {
      const t0 = performance.now()
      const scorer = openHpoGeneScorer(profiles[level], HPO_DB)
      ms.push(performance.now() - t0)
      const score = (g: string): number | null => scorer?.score(g) ?? null
      const causal = score(c.gene)
      out.causal.push({ bin: resnikBin(causal), score: causal })
      causalScores[li].push(causal)
      const counts = Array.from({ length: input.k }, () => new Array<number>(RESNIK_BINS).fill(0))
      for (const [g, n] of eligible) {
        const s = score(g)
        counts[input.folds.get(g) ?? 0][resnikBin(s)] += n
        hist[li][
          s === null ? HIST_BINS - 1 : Math.min(Math.floor(s / HIST_WIDTH), HIST_BINS - 2)
        ] += n
      }
      out.background.push(counts)
    })
    return out
  })
  return { scored, calibration: { levels: LEVELS, hist, histWidth: HIST_WIDTH, causalScores }, ms }
}

/**
 * Fold points: positives = training cases' causal alleles, background = per background the mean
 * (over its training cases) of training-gene eligible rows per bin, summed over backgrounds —
 * spec §11.1 units (rows once per background). Levels are pooled with equal weight.
 */
function tuneFolds(cases: PhenoCase[], scored: Scored[], input: PhenoBenchInput): number[][] {
  return Array.from({ length: input.k }, (_, f) => {
    const a = new Array<number>(RESNIK_BINS).fill(0)
    const perBg = new Map<string, { b: number[]; n: number }>()
    cases.forEach(({ c }, i) => {
      if (input.folds.get(c.gene) === f) return
      const acc = perBg.get(c.bg) ?? { b: new Array<number>(RESNIK_BINS).fill(0), n: 0 }
      perBg.set(c.bg, acc)
      acc.n++
      scored[i].causal.forEach(({ bin }, li) => {
        a[bin] += c.causal.length / LEVELS.length
        scored[i].background[li].forEach((counts, gf) => {
          if (gf !== f) counts.forEach((n, bin2) => (acc.b[bin2] += n / LEVELS.length))
        })
      })
    })
    const b = new Array<number>(RESNIK_BINS).fill(0)
    for (const { b: sum, n } of perBg.values()) sum.forEach((x, bin) => (b[bin] += x / n))
    return tuneResnikPoints(a, b)
  })
}

const withResnik = (rs: EvidenceRuleset, points: readonly number[]): EvidenceRuleset => ({
  ...rs,
  groups: [...rs.groups, resnikGroup(points)]
})

function foldConfigs(
  tunedVarvis: EvidenceRuleset[],
  tunedPoints: number[][]
): {
  fixed: Array<Record<string, ShortlistConfig>>
  perProfile: Array<Record<string, ShortlistConfig>>
} {
  const noPheno = tunedVarvis.map((rs) => zeroGroups(rs, ['phenotype']))
  return {
    fixed: tunedVarvis.map((rs, f) => ({
      a: evidenceConfig(noPheno[f]),
      b: evidenceConfig(rs)
    })),
    perProfile: noPheno.map((rs, f) => ({
      c_tuned: evidenceConfig(withResnik(rs, tunedPoints[f])),
      c_hand: evidenceConfig(withResnik(rs, RESNIK_HAND_POINTS))
    }))
  }
}

export async function runPhenoBench(input: PhenoBenchInput): Promise<void> {
  const cases = phenoCases(input.cases, input.pool)
  console.log(`pheno: ${cases.length}/${input.cases.length} cases with an HPO-annotated disease`)
  const { scored, calibration, ms } = scoreCases(cases, input)
  const tunedPoints = tuneFolds(cases, scored, input)
  const configs = foldConfigs(input.tunedVarvis, tunedPoints)
  // Workers inherit the env: the production shortlist opens the scorer from this path.
  process.env[HPO_DATA_CONFIG.envPath] = HPO_DB

  const jobs: Job[] = []
  for (const scenario of SCENARIOS) {
    for (const bg of input.init.backgrounds) {
      const own = cases.filter((p) => p.c.bg === bg.caseLabel)
      for (let i = 0; i < own.length; i += CHUNK) {
        const part = own.slice(i, i + CHUNK)
        jobs.push({
          kind: 'pheno',
          bg: bg.caseLabel,
          scenario,
          cases: part.map((p) => p.c),
          folds: part.map((p) => input.folds.get(p.c.gene)!),
          profiles: part.map((p) => p.profiles),
          ...configs
        })
      }
    }
  }
  const results: CaseResult[] = []
  const out = createWriteStream(join(input.outDir, 'pheno-results.jsonl'))
  for (const r of (await runJobs(
    jobs,
    input.init,
    input.workers,
    input.progress('pheno')
  )) as Array<Extract<JobResult, { kind: 'eval' }>>) {
    for (const res of r.results) {
      out.write(JSON.stringify(res) + '\n')
      results.push(res)
    }
  }
  await new Promise<void>((res) => out.end(res))
  const md = renderPhenoReport({
    results,
    tunedPoints,
    calibration,
    scoreMs: ms,
    cases: cases.length,
    eligibleCases: input.cases.length,
    reps: input.reps,
    seed: input.seed
  })
  writeFileSync(join(input.outDir, 'pheno-report.md'), md)
  console.log(`pheno: ${results.length} results → ${join(input.outDir, 'pheno-report.md')}`)
}
