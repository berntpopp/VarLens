/**
 * Per-index constants for the background-corrected scoring modes (spec v2,
 * criteria 3 and 4; `.cache/.../s5-research-fixes.md` A1, B1): σ floors of
 * the stored null and the per-term exclusion background b_e. Computed lazily
 * on first use and cached per index, so the default mode never pays for them.
 */
import { HPO_SCORING_CONFIG, type HpoScoringOptions } from '../config/hpo-scoring.config'
import type { PhenotypeIndex } from './phenotype-index'

export function scoringOptions(overrides: Partial<HpoScoringOptions> = {}): HpoScoringOptions {
  const c = HPO_SCORING_CONFIG
  return {
    correction: c.backgroundCorrection,
    tau: c.tau,
    geneMaxPenalty: c.geneMaxPenalty,
    lrEpsilon: c.lrEpsilon,
    lambdaZ: c.lambdaZ,
    excludeMinFrequency: c.excludeMinFrequency,
    exclusionMode: c.exclusionMode,
    ...overrides
  }
}

/** The S⁺ parameters a stored null is only valid for. */
export function nullParams(tau: number): string {
  const { alphaF, f0, gamma } = HPO_SCORING_CONFIG
  return JSON.stringify({ alphaF, f0, gamma, tau })
}

interface Calibration {
  /** σ floor per query size (column k − 1) */
  sigmaFloor: Float64Array
  /** b_e: mean over diseases of max f over the disease's annotations that are e or below */
  background: Float64Array
}
const calibrations = new WeakMap<PhenotypeIndex, Calibration>()

function sigmaFloors(ix: PhenotypeIndex): Float64Array {
  const K = HPO_SCORING_CONFIG.nullMaxK
  const D = ix.diseaseIds.length
  const floors = new Float64Array(K)
  if (ix.nullSd === null || D === 0) return floors
  const column = new Float64Array(D)
  for (let k = 0; k < K; k++) {
    for (let d = 0; d < D; d++) column[d] = ix.nullSd[d * K + k]
    column.sort()
    floors[k] = column[Math.floor(HPO_SCORING_CONFIG.sigmaFloorQuantile * (D - 1))]
  }
  return floors
}

/** Per disease, each ancestor-or-self of its annotations gets the highest f below it once. */
function exclusionBackground(ix: PhenotypeIndex): Float64Array {
  const { parentOffsets, parents } = ix.hpo
  const V = ix.hpo.ids.length
  const D = ix.diseaseIds.length
  const sum = new Float64Array(V)
  const mark = new Int32Array(V)
  const stack = new Int32Array(V)
  for (let d = 0; d < D; d++) {
    const from = ix.diseaseOffsets[d]
    const order = Array.from({ length: ix.diseaseOffsets[d + 1] - from }, (_, i) => from + i)
    order.sort((a, b) => ix.annF[b] - ix.annF[a])
    for (const j of order) {
      // Highest f first: the first visit of a term carries its max.
      let top = 0
      if (mark[ix.annTerm[j]] === d + 1) continue
      mark[ix.annTerm[j]] = d + 1
      stack[top++] = ix.annTerm[j]
      while (top > 0) {
        const u = stack[--top]
        sum[u] += ix.annF[j]
        for (let p = parentOffsets[u]; p < parentOffsets[u + 1]; p++) {
          if (mark[parents[p]] !== d + 1) {
            mark[parents[p]] = d + 1
            stack[top++] = parents[p]
          }
        }
      }
    }
  }
  for (let t = 0; t < V; t++) sum[t] = D === 0 ? 0 : sum[t] / D
  return sum
}

export function calibrationFor(ix: PhenotypeIndex): Calibration {
  let c = calibrations.get(ix)
  if (c === undefined) {
    c = { sigmaFloor: sigmaFloors(ix), background: exclusionBackground(ix) }
    calibrations.set(ix, c)
  }
  return c
}

/** Linear interpolation of a null column at the effective query size kEff (clamped to 1..nullMaxK). */
export function nullColumns(kEff: number): { lo: number; hi: number; frac: number } {
  const K = HPO_SCORING_CONFIG.nullMaxK
  const k = Math.min(K, Math.max(1, kEff))
  const lo = Math.floor(k)
  return { lo: lo - 1, hi: Math.min(lo, K - 1), frac: k - lo }
}

/** z-mode exclusion LR of one excluded term: ≥ 0 (no absence bonus), ≤ −ln ε. */
export function exclusionLr(f: number, background: number, epsilon: number): number {
  const lr = -Math.log(
    ((1 - epsilon) * (1 - f) + epsilon) / ((1 - epsilon) * (1 - background) + epsilon)
  )
  return lr > 0 ? lr : 0
}

/**
 * The z-mode score in (0, 1): ½ + ½·x/(1 + |x|) with x = S/2. Strictly monotone and, unlike a
 * logistic (exactly 1 in float64 from S ≈ 74), distinct in float64 over the whole reachable |z| ≤ ~10³
 * (σ ≥ sigmaMin), so ranks are unchanged.
 */
export const boundedZ = (s: number): number => 0.5 + (0.5 * (s / 2)) / (1 + Math.abs(s / 2))
