/**
 * The `hpo_resnik` evidence group for the variant-level phenotype benchmark (#600), and the
 * fold tuning of its points with the production estimator (`estimatePoints`, spec §11.1).
 */
import type { EvidenceGroup } from '../../../src/shared/types/evidence-ruleset'
import { estimatePoints, type BinCount } from '../stats/points'

export const RESNIK_GROUP = 'hpo_resnik'
/**
 * Lower bin edges, fixed from the public gene-ranking run before any background was opened:
 * the 95th / 99th percentile of all genes' scores is ≈ 1.5 / 2.0, the causal gene's median
 * ≈ 3.0 (clean) / 2.2 (moderate) / 1.7 (noisy).
 */
export const RESNIK_EDGES = [3, 2.5, 2, 1.5] as const
/** Hand-set points (reference last): the varvis `hpo_sim_score` group's 4/3/2/1/0 ladder. */
export const RESNIK_HAND_POINTS = [4, 3, 2, 1, 0] as const
/** Bins = edges plus the reference (below the last edge or no score). */
export const RESNIK_BINS = RESNIK_EDGES.length + 1

/** Bin index of a score: 0 = top, RESNIK_EDGES.length = reference. */
export function resnikBin(score: number | null): number {
  if (score === null) return RESNIK_EDGES.length
  const i = RESNIK_EDGES.findIndex((edge) => score >= edge)
  return i < 0 ? RESNIK_EDGES.length : i
}

/** Exclusive range bins over `hpo_resnik`, then the reference (complete partition); one point per bin. */
export function resnikGroup(points: readonly number[]): EvidenceGroup {
  const e = RESNIK_EDGES
  return {
    id: RESNIK_GROUP,
    label: 'HPO Resnik similarity',
    scope: 'global',
    rules: [
      ...e.map((lo, i) => ({
        id: `resnik_${i}`,
        label: i === 0 ? `Resnik ≥ ${lo}` : `Resnik ${lo}–${e[i - 1]}`,
        when: i === 0 ? `hpo_resnik:>=:${lo}` : `hpo_resnik:>=:${lo} AND hpo_resnik:<:${e[i - 1]}`,
        points: points[i]
      })),
      {
        id: 'resnik_ref',
        label: `Resnik < ${e[e.length - 1]} or no HPO data (reference)`,
        when: `hpo_resnik:is:null OR hpo_resnik:<:${e[e.length - 1]}`,
        points: points[e.length]
      }
    ]
  }
}

/**
 * Tuned points per bin (reference last) from per-bin counts: `a` = training positives,
 * `b` = training background rows (spec §11.1 units), relative to the anchor bin.
 */
export function tuneResnikPoints(a: readonly number[], b: readonly number[]): number[] {
  const bins: BinCount[] = a.map((ai, i) => ({
    id: String(i),
    a: ai,
    b: b[i],
    isReference: i === RESNIK_EDGES.length
  }))
  const sum = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0)
  return estimatePoints(bins, sum(a), sum(b)).map((p) => p.points)
}
