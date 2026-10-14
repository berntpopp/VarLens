/**
 * STR benchmark of the CNV/STR phenotype score (spec §7.2; protocol "STR"): causal arms with and
 * without decoys against today's gene-level score, the T1–T5 trick arms (STR-1) and STR-4.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  openHpoGeneScorer,
  type HpoGeneScorer
} from '../../../src/main/services/phenotype/hpo-similarity-db'
import { ancestorClosure, parseHpJson } from '../../../src/shared/phenotype/hpo-sources'
import { bandOf, scoreStr, type StrRow } from '../../../src/shared/phenotype/str-score'
import type { HpoProfileTerm } from '../../../src/shared/types/hpo-profile'
import type { LocusReference, StrLocus } from '../../../src/shared/types/locus-reference'
import { HPO_DB_V6, HPO_RAW_DIR } from '../common/paths'
import { rng } from '../common/rng'
import {
  diseaseSeed,
  NOISE_LEVELS,
  profileOntology,
  sampleProfile,
  type NoiseLevelId,
  type ProfileOntology
} from '../phenotype/profiles'
import type { Disease } from '../phenotype/profiles'
import { standingAmong } from './cnv-arms'
import { hpoaDiseases } from './cnv-sim'
import {
  alleles,
  allowedDiseases,
  causalLoci,
  decoyValue,
  DECOYS,
  drawDecoys,
  fullAllele,
  recessiveOnly,
  strRow,
  type Sex
} from './str-sim'
import { caseMetrics, type CaseMetrics } from './summary'

export const STR_SEED = 20261014
const SALT = { profile: 0x5701, sex: 0x5702, genotype: 0x5703, decoy: 0x5704, trick: 0x5705 }
const TRICK_SEEDS = 20
const LEVELS = Object.keys(NOISE_LEVELS) as NoiseLevelId[]
export const DECOY_ARMS = ['none', 'population', 'all'] as const
export type DecoyArm = (typeof DECOY_ARMS)[number]

const present = (ids: readonly string[]): HpoProfileTerm[] =>
  [...new Set(ids)].map((hpoId) => ({ hpoId, excluded: false, key: false }))

interface Ctx {
  loci: StrLocus[]
  byId: Map<string, StrLocus>
  diseases: Map<string, Disease>
  ont: ProfileOntology
}

function profile(
  ctx: Ctx,
  disease: string,
  level: NoiseLevelId,
  key: string
): HpoGeneScorer | null {
  const s = sampleProfile(
    ctx.diseases.get(disease)!,
    NOISE_LEVELS[level],
    ctx.ont,
    rng(diseaseSeed(key, STR_SEED ^ SALT.profile))
  )
  return openHpoGeneScorer(present([...s.reported, ...s.noise]), HPO_DB_V6)
}

/** The case's rows: a normal call per locus, then `overrides` (locus id → alleles). */
function caseRows(ctx: Ctx, sex: Sex | null, key: string, overrides: Map<string, number[]>) {
  const rnd = rng(diseaseSeed(key, STR_SEED ^ SALT.genotype))
  return ctx.loci.map((l) => {
    const normal = alleles(l, sex, rnd)
    return { locus: l, row: strRow(l, overrides.get(l.id) ?? normal) }
  })
}

const scoreOf = (row: StrRow, ref: LocusReference, sex: Sex | null, hpo: HpoGeneScorer | null) =>
  scoreStr(row, ref, { build: 'GRCh38', sex, hpo: hpo ?? undefined, hetHits: () => 0 })

/** Causal arms: one case per locus × level × decoy arm; new score vs gene-level baseline. */
function causalArms(ctx: Ctx, ref: LocusReference) {
  const out = Object.fromEntries(
    DECOY_ARMS.map((d) => [d, Object.fromEntries(LEVELS.map((lv) => [lv, [] as CaseMetrics[]]))])
  ) as Record<DecoyArm, Record<NoiseLevelId, CaseMetrics[]>>
  const causal = causalLoci(ctx.loci, (id) => ctx.diseases.has(id))
  for (const l of causal) {
    const key = l.id
    const sex: Sex =
      l.chrom === 'X'
        ? 'male'
        : rng(diseaseSeed(key, STR_SEED ^ SALT.sex))() < 0.5
          ? 'male'
          : 'female'
    const targets = l.diseases.full.filter((id) => ctx.diseases.has(id)).sort()
    const disease =
      targets[Math.floor(rng(diseaseSeed(key, STR_SEED ^ SALT.profile))() * targets.length)]
    const grnd = rng(diseaseSeed(`${key}:causal`, STR_SEED ^ SALT.genotype))
    const causalAlleles = alleles(l, sex, grnd, {
      value: () => fullAllele(l, grnd),
      biallelic: recessiveOnly(l)
    })
    for (const decoyArm of DECOY_ARMS) {
      const drnd = rng(diseaseSeed(key, STR_SEED ^ SALT.decoy))
      const decoys = decoyArm === 'none' ? [] : drawDecoys(sex, drnd, decoyArm === 'all')
      const overrides = new Map<string, number[]>([[l.id, causalAlleles]])
      for (const d of decoys) {
        const dl = ctx.byId.get(DECOYS[d].id)
        if (dl === undefined || dl.id === l.id) continue
        overrides.set(dl.id, alleles(dl, sex, drnd, { value: decoyValue(d, dl, drnd) }))
      }
      const rows = caseRows(ctx, sex, key, overrides)
      for (const level of LEVELS) {
        const hpo = profile(ctx, disease, level, key)
        const newScore = rows.map((r) => scoreOf(r.row, ref, sex, hpo)?.score ?? null)
        const base = rows.map((r) => hpo?.score(r.locus.gene) ?? null)
        const i = rows.findIndex((r) => r.locus.id === l.id)
        const others = <T>(xs: T[]): T[] => xs.filter((_, j) => j !== i)
        out[decoyArm][level].push(
          caseMetrics(l.gene, [
            {
              new: standingAmong(newScore[i], others(newScore)),
              baseline: standingAmong(base[i], others(base))
            }
          ])
        )
      }
    }
  }
  return { out, causalLoci: causal.length }
}

interface Trick {
  name: string
  disease: (rnd: () => number) => string
  sex: Sex
  locus?: string
  value?: (l: StrLocus, rnd: () => number) => number
}

/** STR-1: every trick row (and every T5 row) must name a disease of its band or stay null. */
function trickArms(ctx: Ctx, ref: LocusReference) {
  const t5Pool = [...new Set(ctx.loci.flatMap((l) => l.diseases.full))]
    .filter((d) => ctx.diseases.has(d))
    .sort()
  const fmr1 = ctx.byId.get(DECOYS.fmr1.id)!
  const tricks: Trick[] = [
    {
      name: 'T1',
      disease: () => 'OMIM:610954',
      sex: 'female',
      locus: DECOYS.tcf4.id,
      value: fullAllele
    },
    {
      name: 'T2',
      disease: () => 'OMIM:300624',
      sex: 'male',
      locus: fmr1.id,
      value: (l, r) => decoyValue('fmr1', l, r)()
    },
    {
      name: 'T3',
      disease: () => 'OMIM:614575',
      sex: 'female',
      locus: DECOYS.rfc1.id,
      value: fullAllele
    },
    {
      name: 'T4',
      disease: () => 'OMIM:313200',
      sex: 'female',
      locus: 'SBMA_AR',
      value: fullAllele
    },
    { name: 'T5', disease: (r) => t5Pool[Math.floor(r() * t5Pool.length)], sex: 'female' }
  ]
  const results: Array<{ name: string; cases: number; falseLeads: number; examples: string[] }> = []
  for (const t of tricks) {
    let falseLeads = 0
    let cases = 0
    const examples: string[] = []
    for (let s = 0; s < TRICK_SEEDS; s++) {
      const key = `${t.name}:${s}`
      const rnd = rng(diseaseSeed(key, STR_SEED ^ SALT.trick))
      const overrides = new Map<string, number[]>()
      const l = t.locus === undefined ? undefined : ctx.byId.get(t.locus)
      if (l !== undefined)
        overrides.set(l.id, alleles(l, t.sex, rnd, { value: () => t.value!(l, rnd) }))
      const disease = t.disease(rnd)
      const rows = caseRows(ctx, t.sex, key, overrides)
      for (const level of LEVELS) {
        cases++
        const hpo = profile(ctx, disease, level, key)
        for (const r of rows) {
          if (t.name !== 'T5' && r.locus.id !== l?.id) continue
          const sc = scoreOf(r.row, ref, t.sex, hpo)
          if (sc === null || sc.score === null) continue
          const gateFails = t.name === 'T3' || t.name === 'T4' || t.name === 'T5'
          const band = bandOf(r.row, r.locus).band
          const outside = !allowedDiseases(r.locus, band, t.sex).has(sc.bestDisease ?? '')
          if (gateFails || outside) {
            falseLeads++
            if (examples.length < 5)
              examples.push(
                `${r.locus.id} ${r.row.str_alt_copies} ${band} → ${sc.bestDisease} (${level})`
              )
          }
        }
      }
    }
    results.push({ name: t.name, cases, falseLeads, examples })
  }
  return results
}

/** STR-4: the admitted catalogue diseases are indexed and score > 0 on their full HPOA profile. */
function admitted(ctx: Ctx): Array<{ id: string; score: number | null }> {
  return ['ORPHA:273', 'ORPHA:401901', 'ORPHA:98757'].map((id) => {
    const d = ctx.diseases.get(id)
    const scorer =
      d === undefined ? null : openHpoGeneScorer(present([...d.terms.keys()]), HPO_DB_V6)
    return { id, score: scorer?.scoreDiseases([id])?.score ?? null }
  })
}

export function runStrBench(ref: LocusReference) {
  const hp = parseHpJson(readFileSync(join(HPO_RAW_DIR, 'hp.json'), 'utf8'))
  const loci = ref.strLoci.filter((l) => l.hg38 !== null)
  const ctx: Ctx = {
    loci,
    byId: new Map(loci.map((l) => [l.id, l])),
    diseases: hpoaDiseases(readFileSync(join(HPO_RAW_DIR, 'phenotype.hpoa'), 'utf8')),
    ont: profileOntology(hp, ancestorClosure(hp))
  }
  const causal = causalArms(ctx, ref)
  return {
    loci: loci.length,
    causalLoci: causal.causalLoci,
    causal: causal.out,
    tricks: trickArms(ctx, ref),
    admitted: admitted(ctx)
  }
}
export type StrRun = ReturnType<typeof runStrBench>
