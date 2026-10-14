/**
 * Excluded- and key-term arms of the HPO scoring v2 benchmark (spec §5, #600), applied on top
 * of the sprint-3 profiles (profiles.ts). Pure: mimic diseases come from the caller.
 *
 *   E0  no exclusions, no keys (regression arm: the sprint-3 profiles unchanged)
 *   E1  realistic: frequent features of mimic diseases ruled out, leading findings marked key
 *   E2  E1 + adversarial errors: a true frequent feature ruled out, a noise term marked key
 */
import type { HpoProfileTerm } from '../../../src/shared/types/hpo-profile'
import { shuffle } from '../common/rng'
import type { Disease, NoiseLevelId, SampledProfile } from './profiles'

export const ARMS = ['E0', 'E1', 'E2'] as const
export type ArmId = (typeof ARMS)[number]

/** Pre-registered arm parameters (spec §5); not tuned. */
export const ARM_CONFIG = {
  /** Differential diagnoses a clinician would rule out: the 10 most similar other diseases. */
  mimics: 10,
  /** Only a feature present in most mimic patients (f ≥ 0.7) is worth an explicit exclusion. */
  mimicMinFrequency: 0.7,
  /** Excluded mimic features per case, drawn uniformly: a short rule-out list. */
  exclusionCounts: [2, 3],
  /** Key terms per case, drawn uniformly: the one or two leading findings. */
  keyCounts: [1, 2],
  /** E2 false exclusion: a common but not universal true feature (missed or not yet expressed). */
  falseExclusionMin: 0.5,
  falseExclusionMax: 0.9,
  /** E2: share of noisy-level cases in which a noise term is marked key. */
  noiseKeyShare: 0.25,
  noiseKeyLevel: 'noisy' as NoiseLevelId,
  /** XOR-ed into the disease seed: arm draws never shift the sprint-3 profile stream. */
  seedSalt: 0x5eed_e1e2
} as const

export interface ArmContext {
  ancestors: Map<string, string[]>
  /** Annotation IC of a term (0 when unknown). */
  ic: (term: string) => number
  isAbnormality: Set<string>
}

/** Level-independent draws for one disease, shared by every noise level (paired strata). */
export interface ArmDraw {
  /** E1/E2: mimic features absent from the true disease's ancestor closure. */
  exclusions: string[]
  /** True terms (from `truth`) to mark key. */
  keyTruth: string[]
  /** E2: a true feature with f ∈ [0.5, 0.9] outside Anc(truth), or null if there is none. */
  falseExclusion: string | null
  /** E2: mark a noise term key (noisy level only), and which (uniform in [0, 1)). */
  noiseKey: boolean
  noiseKeyPick: number
}

/** The `n` highest-scored disease ids (ties by id) outside `exclude`. */
export function topMimics(
  scores: Float64Array,
  ids: readonly string[],
  exclude: ReadonlySet<string>,
  n: number
): string[] {
  return ids
    .map((id, i) => ({ id, s: scores[i] }))
    .filter((x) => !exclude.has(x.id))
    .sort((a, b) => b.s - a.s || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, n)
    .map((x) => x.id)
}

function closureOf(terms: Iterable<string>, ancestors: Map<string, string[]>): Set<string> {
  const out = new Set<string>()
  for (const t of terms) for (const a of ancestors.get(t) ?? [t]) out.add(a)
  return out
}

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Draws one disease's arm terms; consumes `rnd` in a fixed order. */
export function drawArms(
  disease: Disease,
  truth: readonly string[],
  mimics: readonly Disease[],
  ctx: ArmContext,
  rnd: () => number
): ArmDraw {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]
  const closure = closureOf(disease.terms.keys(), ctx.ancestors)
  const candidates = new Set<string>()
  for (const m of mimics)
    for (const [t, f] of m.terms)
      if (f >= ARM_CONFIG.mimicMinFrequency && ctx.isAbnormality.has(t) && !closure.has(t))
        candidates.add(t)
  const exclusions = shuffle([...candidates].sort(byId), rnd).slice(
    0,
    pick(ARM_CONFIG.exclusionCounts)
  )
  const fic = (t: string): number => (disease.terms.get(t) ?? 0) * ctx.ic(t)
  const keyTruth = [...new Set(truth)]
    .sort((a, b) => fic(b) - fic(a) || byId(a, b))
    .slice(0, pick(ARM_CONFIG.keyCounts))
  const truthClosure = closureOf(truth, ctx.ancestors)
  const falsePool = [...disease.terms]
    .filter(
      ([t, f]) =>
        f >= ARM_CONFIG.falseExclusionMin &&
        f <= ARM_CONFIG.falseExclusionMax &&
        ctx.isAbnormality.has(t) &&
        !truthClosure.has(t)
    )
    .map(([t]) => t)
    .sort(byId)
  const falseExclusion = falsePool.length > 0 ? pick(falsePool) : null
  const noiseKey = rnd() < ARM_CONFIG.noiseKeyShare
  return { exclusions, keyTruth, falseExclusion, noiseKey, noiseKeyPick: rnd() }
}

/** The scorer input of one arm; a term reported present is never also excluded. */
export function armProfile(
  arm: ArmId,
  sampled: SampledProfile,
  draw: ArmDraw,
  level: NoiseLevelId
): HpoProfileTerm[] {
  const present = [...new Set([...sampled.reported, ...sampled.noise])]
  const keys = new Set<string>()
  const excluded: string[] = []
  if (arm !== 'E0') {
    sampled.truth.forEach((t, i) => {
      if (draw.keyTruth.includes(t)) keys.add(sampled.reported[i])
    })
    excluded.push(...draw.exclusions)
  }
  if (arm === 'E2') {
    if (draw.falseExclusion !== null) excluded.push(draw.falseExclusion)
    const { noise } = sampled
    if (draw.noiseKey && level === ARM_CONFIG.noiseKeyLevel && noise.length > 0)
      keys.add(noise[Math.floor(draw.noiseKeyPick * noise.length)])
  }
  return [
    ...present.map((hpoId) => ({ hpoId, excluded: false, key: keys.has(hpoId) })),
    ...[...new Set(excluded)]
      .filter((e) => !present.includes(e))
      .map((hpoId) => ({ hpoId, excluded: true, key: false }))
  ]
}
