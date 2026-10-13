// Point estimator of spec §11.1/§11.9 over first-match counts, as a pure function.

export interface BinCount {
  id: string
  /** Training positives (causal spike instances) assigned to this bin. */
  a: number
  /** Distinct eligible training background rows assigned to this bin. */
  b: number
  isReference: boolean
}

export interface BinPoints {
  id: string
  a: number
  b: number
  isReference: boolean
  /** Best-supported bin of the group; its points are 0 by construction. */
  isAnchor: boolean
  /** Unrounded log2 enrichment relative to the anchor (NaN when unsupported). */
  raw: number
  points: number
  supported: boolean
}

export const MIN_BIN_SUPPORT = 10
/** Fewer training positives than this in a group → the whole group scores 0. */
export const MIN_GROUP_POSITIVES = 20
export const MAX_POINTS = 8
/** A bin needs this many positives to score above the anchor. */
export const MIN_POSITIVES_FOR_BONUS = 5

/** Round to the nearest 0.5, half away from zero (symmetric for penalties), clipped to ±8. */
export function roundPoints(v: number): number {
  const r = (Math.sign(v) * Math.round(Math.abs(v) * 2)) / 2
  return Math.min(MAX_POINTS, Math.max(-MAX_POINTS, r)) + 0 // + 0 turns −0 into 0
}

/**
 * Spec §14–15 (amend §11.1). A group is a complete partition of eligible rows, so adding a
 * constant to all its bins shifts every row equally: the ranking does not depend on which bin
 * is 0. Per bin e_j = log2[((a_j+½)/(A+K/2)) / ((b_j+½)/(B+K/2))], K = number of bins; the
 * anchor is the bin with the most positives (largest a_j; ties → larger b_j, then the earlier
 * bin) and points_j = round½(e_j − e_anchor), clipped ±8. A bin with a_j + b_j < 10 scores 0
 * (anchor level); a bin with a_j < 5 never scores above the anchor; a group with A < 20
 * training positives scores 0 throughout. `isReference` (the catch-all rule) is descriptive.
 */
export function estimatePoints(
  bins: BinCount[],
  A: number,
  B: number,
  /** Fix the anchor (bootstrap draws stay relative to the point estimate's anchor). */
  anchorId?: string
): BinPoints[] {
  if (bins.length === 0) return []
  const K = bins.length
  const e = (x: BinCount): number =>
    Math.log2((x.a + 0.5) / (A + K / 2) / ((x.b + 0.5) / (B + K / 2)))
  const anchor =
    bins.find((x) => x.id === anchorId) ??
    bins.reduce((best, x) => (x.a > best.a || (x.a === best.a && x.b > best.b) ? x : best), bins[0])
  const groupOk = A >= MIN_GROUP_POSITIVES
  return bins.map((bin) => {
    const supported = groupOk && bin.a + bin.b >= MIN_BIN_SUPPORT
    const raw = supported ? e(bin) - e(anchor) : Number.NaN
    return {
      ...bin,
      isAnchor: bin === anchor,
      raw,
      supported,
      // Too few positives to support a bonus: a bin can then only lose points (spec §15).
      points: !supported
        ? 0
        : bin.a < MIN_POSITIVES_FOR_BONUS
          ? Math.min(roundPoints(raw), 0)
          : roundPoints(raw)
    }
  })
}
