/**
 * CNV benchmark of the CNV/STR phenotype score (spec §7.1, pre-registered protocol in
 * .planning/artifacts/shortlist-sim/2026-10-14-cnv-str/protocol.md):
 *
 *   npx jiti scripts/shortlist-sim/cnv-str/cnv-bench.ts --run <name>
 *
 * Needs HPO_DB_V6 (`npm run build:hpo-db -- --tag v2026-09-01 --out <HPO_DB_V6>`), the
 * phenopacket-store 0.1.27 extract and the CNV_STR_EXTERNAL_DIR downloads. Writes per-case records
 * to RUNS_DIR/<name>/ and returns the aggregates for the report.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openHpoGeneScorer } from '../../../src/main/services/phenotype/hpo-similarity-db'
import type { CnvPhenotypeScorer } from '../../../src/shared/phenotype/cnv-score'
import { ancestorClosure, parseHpJson } from '../../../src/shared/phenotype/hpo-sources'
import type { HpoProfileTerm } from '../../../src/shared/types/hpo-profile'
import type { LocusReference } from '../../../src/shared/types/locus-reference'
import { CNV_STR_EXTERNAL_DIR, DATA_DIR, HPO_DB_V6, HPO_RAW_DIR } from '../common/paths'
import { rng } from '../common/rng'
import { averageRanks, spearman } from '../phenotype/gene-ranking-report'
import {
  diseaseSeed,
  NOISE_LEVELS,
  profileOntology,
  sampleProfile,
  type NoiseLevelId
} from '../phenotype/profiles'
import { loadBackgrounds, type Background } from './backgrounds'
import {
  armEnv,
  CNV_ARMS,
  prepareCnv,
  scoreArms,
  standingAmong,
  type ArmEnv,
  type CnvArm,
  type PreparedCnv
} from './cnv-arms'
import { loadCnvCases, type Build } from './cnv-phenopackets'
import { clinvarCases, hpoaDiseases, regionCases, type SimCnvCase } from './cnv-sim'
import { caseMetrics, type CaseMetrics, type Standing } from './summary'

export const SEED = 20261015
const SALT_PROFILE = 0x9f01
export const PHENOPACKET_DIR = join(DATA_DIR, 'external/phenopacket-store/0.1.27/extracted')
export const BACKGROUND_VCF: Record<Build, string> = {
  GRCh37: join(CNV_STR_EXTERNAL_DIR, 'ALL.wgs.mergedSV.v8.20130502.svs.genotypes.vcf.gz'),
  GRCh38: join(CNV_STR_EXTERNAL_DIR, '1KGP_3202.gatksv_svtools_novelins.freeze_V3.wAF.vcf.gz')
}
export const CLINVAR_SUMMARY = join(CNV_STR_EXTERNAL_DIR, 'variant_summary.txt.gz')

const present = (ids: readonly string[]): HpoProfileTerm[] =>
  [...new Set(ids)].map((hpoId) => ({ hpoId, excluded: false, key: false }))

/** One background, prepared once per build and scored once per profile. */
interface PreparedBackground {
  sample: string
  large: boolean
  cnvs: PreparedCnv[]
}

/** Per (profile, background): each arm's causal standing, plus CNV-4's ρ for real cases. */
export interface BgResult {
  large: boolean
  standing: Record<CnvArm, Standing>
  rho?: { A3: number; A0: number }
}

/** Scores the case's causal CNVs and every background against one profile. */
export function rankProfile(
  causal: readonly PreparedCnv[],
  backgrounds: readonly PreparedBackground[],
  scorer: CnvPhenotypeScorer | null,
  env: ArmEnv,
  withRho: boolean
): BgResult[] {
  const nulls = (): Record<CnvArm, number | null> =>
    Object.fromEntries(CNV_ARMS.map((a) => [a, null])) as Record<CnvArm, number | null>
  const score = (p: PreparedCnv): { scores: Record<CnvArm, number | null>; n: number } =>
    scorer === null ? { scores: nulls(), n: 0 } : scoreArms(p, scorer, env)
  const best = nulls()
  for (const p of causal) {
    const { scores } = score(p)
    for (const a of CNV_ARMS) {
      const s = scores[a]
      if (s !== null && (best[a] === null || s > best[a])) best[a] = s
    }
  }
  return backgrounds.map((bg) => {
    const scored = bg.cnvs.map(score)
    const standing = Object.fromEntries(
      CNV_ARMS.map((a) => [
        a,
        standingAmong(
          best[a],
          scored.map((s) => s.scores[a])
        )
      ])
    ) as Record<CnvArm, Standing>
    if (!withRho) return { large: bg.large, standing }
    const kept = scored.filter((s) => s.n >= 1)
    const n = averageRanks(Float64Array.from(kept, (s) => s.n))
    const rho = (a: CnvArm): number =>
      spearman(
        Float64Array.from(kept, (s) => s.scores[a] ?? 0),
        n
      )
    return { large: bg.large, standing, rho: { A3: rho('A3'), A0: rho('A0') } }
  })
}

export interface CnvRun {
  real: Array<CaseMetrics & { id: string; build: Build; rho: Array<{ A3: number; A0: number }> }>
  /** level → cases, all backgrounds; `large`: only the ≥ 1 Mb backgrounds (CNV-2). */
  sim: Record<NoiseLevelId, { all: SimResult[]; large: SimResult[] }>
  counts: Record<string, number | string>
  backgrounds: Record<Build, Array<{ sample: string; large: boolean; calls: number }>>
  /** Profiles in protocol order (real, then moderate simulated) for CNV-5/CNV-6; not saved. */
  profiles?: HpoProfileTerm[][]
}
type SimResult = CaseMetrics & { id: string; source: SimCnvCase['source'] }

export interface CnvInputs {
  reference: LocusReference
  lookups: Record<Build, import('../../../src/shared/phenotype/cnv-score').GeneSpanLookup>
}

/** The whole CNV benchmark (no latency, no CNV-5: see cnv-checks.ts). */
export async function runCnvBench(
  { reference, lookups }: CnvInputs,
  outDir: string
): Promise<CnvRun> {
  const hp = parseHpJson(readFileSync(join(HPO_RAW_DIR, 'hp.json'), 'utf8'))
  const ont = profileOntology(hp, ancestorClosure(hp))
  const diseases = hpoaDiseases(readFileSync(join(HPO_RAW_DIR, 'phenotype.hpoa'), 'utf8'))
  const envs = { GRCh37: armEnv('GRCh37', reference), GRCh38: armEnv('GRCh38', reference) }
  const bgs = {} as Record<Build, PreparedBackground[]>
  const raw = {} as Record<Build, Background[]>
  for (const build of ['GRCh37', 'GRCh38'] as const) {
    raw[build] = await loadBackgrounds(build, BACKGROUND_VCF[build], SEED)
    bgs[build] = raw[build].map((b) => ({
      sample: b.sample,
      large: b.large,
      cnvs: b.calls.map((c) => prepareCnv(c, lookups[build]))
    }))
  }
  const prep = (build: Build, c: Parameters<typeof prepareCnv>[0]): PreparedCnv =>
    prepareCnv(c, lookups[build])

  const { cases: realCases, svFiles } = loadCnvCases(PHENOPACKET_DIR, lookups)
  const profiles: HpoProfileTerm[][] = []
  const real: CnvRun['real'] = realCases.map((c) => {
    profiles.push(present(c.observed))
    const scorer = openHpoGeneScorer(profiles[profiles.length - 1], HPO_DB_V6)
    const res = rankProfile(
      c.cnvs.map((x) => prep(c.build, x)),
      bgs[c.build],
      scorer,
      envs[c.build],
      true
    )
    const m = caseMetrics(
      c.cluster,
      res.map((r) => r.standing)
    )
    return { ...m, id: c.id, build: c.build, rho: res.map((r) => r.rho!) }
  })

  const regions = regionCases(reference, diseases, SEED)
  const clinvar = await clinvarCases(CLINVAR_SUMMARY, diseases, SEED)
  const simCases = [...regions.cases, ...clinvar.cases]
  const sim = {} as CnvRun['sim']
  for (const level of Object.keys(NOISE_LEVELS) as NoiseLevelId[])
    sim[level] = { all: [], large: [] }
  for (const c of simCases) {
    const causal = [prep('GRCh38', c.cnv)]
    for (const level of Object.keys(NOISE_LEVELS) as NoiseLevelId[]) {
      // Same seed for every level: paired strata share their true terms.
      const s = sampleProfile(
        diseases.get(c.disease)!,
        NOISE_LEVELS[level],
        ont,
        rng(diseaseSeed(c.id, SEED ^ SALT_PROFILE))
      )
      const terms = present([...s.reported, ...s.noise])
      if (level === 'moderate') profiles.push(terms)
      const scorer = openHpoGeneScorer(terms, HPO_DB_V6)
      const res = rankProfile(causal, bgs.GRCh38, scorer, envs.GRCh38, false)
      const pick = (rs: BgResult[]): SimResult => ({
        ...caseMetrics(
          c.cluster,
          rs.map((r) => r.standing)
        ),
        id: c.id,
        source: c.source
      })
      sim[level].all.push(pick(res))
      const large = res.filter((r) => r.large)
      if (large.length > 0) sim[level].large.push(pick(large))
    }
  }
  const counts = {
    svPhenopackets: svFiles,
    realCases: real.length,
    realGRCh37: real.filter((r) => r.build === 'GRCh37').length,
    realGRCh38: real.filter((r) => r.build === 'GRCh38').length,
    regionCases: regions.cases.length,
    regionDropped: regions.dropped,
    clinvarEligible: clinvar.eligible,
    clinvarCases: clinvar.cases.length
  }
  const backgrounds = Object.fromEntries(
    (['GRCh37', 'GRCh38'] as const).map((b) => [
      b,
      raw[b].map((x) => ({ sample: x.sample, large: x.large, calls: x.calls.length }))
    ])
  ) as CnvRun['backgrounds']
  const run: CnvRun = { real, sim, counts, backgrounds }
  writeFileSync(join(outDir, 'cnv-run.json'), JSON.stringify(run))
  return { ...run, profiles }
}
