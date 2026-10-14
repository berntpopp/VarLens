/**
 * Per-disease background null of S⁺ (Phenomizer style, criterion 3 of the
 * v2 spec: score vs annotation breadth). For each query size k = 1..nullMaxK,
 * score `samples` random present-only profiles of k unrelated terms and keep
 * the mean and SD of every disease's S⁺. Terms are drawn per annotation, so a
 * term's chance follows how many diseases list it, like real queries. Run at
 * DB build (worker), never per case.
 */
import { HPO_SCORING_CONFIG } from '../config/hpo-scoring.config'
import type { PhenotypeIndex } from './phenotype-index'
import { prepareProfile, scoreProfile } from './phenotype-score'
import { markAncestors } from './resnik'

export interface DiseaseNull {
  /** [d · maxK + k − 1] */
  mu: Float32Array
  sd: Float32Array
}

/** mulberry32: small, seedable, good enough for sampling. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** k annotation-weighted terms, none an ancestor of another (fewer if the ontology is tiny). */
function sampleTerms(
  ix: PhenotypeIndex,
  k: number,
  rand: () => number,
  marks: { mark: Int32Array; stamp: number }
): number[] {
  const { mark } = marks
  const chosen: number[] = []
  for (let tries = 0; chosen.length < k && tries < 50 * k; tries++) {
    const t = ix.annTerm[Math.floor(rand() * ix.annTerm.length)]
    // Related to a chosen term iff one is in the other's ancestor set.
    markAncestors(ix.hpo, t, mark, ++marks.stamp)
    let related = chosen.some((c) => mark[c] === marks.stamp)
    for (const c of chosen) {
      if (related) break
      markAncestors(ix.hpo, c, mark, ++marks.stamp)
      related = mark[t] === marks.stamp
    }
    if (!related) chosen.push(t)
  }
  return chosen
}

/** μ, σ of S⁺ (forward weight exponent `tau`) per disease and query size. */
export function computeDiseaseNull(
  ix: PhenotypeIndex,
  tau: number = HPO_SCORING_CONFIG.tau,
  samples: number = HPO_SCORING_CONFIG.nullSamples,
  seed: number = HPO_SCORING_CONFIG.nullSeed
): DiseaseNull {
  const K = HPO_SCORING_CONFIG.nullMaxK
  const D = ix.diseaseIds.length
  const sum = new Float64Array(D * K)
  const sumSq = new Float64Array(D * K)
  const rand = rng(seed)
  const marks = { mark: new Int32Array(ix.hpo.ids.length), stamp: 0 }
  for (let k = 1; k <= K; k++) {
    for (let r = 0; r < samples; r++) {
      const terms = sampleTerms(ix, k, rand, marks).map((t) => ({
        hpoId: ix.hpo.ids[t],
        excluded: false,
        key: false
      }))
      const profile = prepareProfile(ix, terms)
      if (profile === null) continue
      const plus = scoreProfile(ix, profile, { correction: 'off', tau }).diseasePlus
      for (let d = 0; d < D; d++) {
        sum[d * K + k - 1] += plus[d]
        sumSq[d * K + k - 1] += plus[d] * plus[d]
      }
    }
  }
  const mu = new Float32Array(D * K)
  const sd = new Float32Array(D * K)
  for (let i = 0; i < D * K; i++) {
    const m = sum[i] / samples
    mu[i] = m
    sd[i] = Math.sqrt(Math.max(0, sumSq[i] / samples - m * m))
  }
  return { mu, sd }
}
