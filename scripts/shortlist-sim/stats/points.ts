// Point estimator of spec §11.1 over first-match counts, as a pure function.

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
  /** Unrounded log2 enrichment relative to the reference (NaN when unsupported). */
  raw: number
  points: number
  supported: boolean
}

export const MIN_BIN_SUPPORT = 10
export const MIN_REFERENCE_COUNT = 5
export const MAX_POINTS = 8

/** Round to the nearest 0.5, half away from zero (symmetric for penalties), clipped to ±8. */
export function roundPoints(v: number): number {
  const r = (Math.sign(v) * Math.round(Math.abs(v) * 2)) / 2
  return Math.min(MAX_POINTS, Math.max(-MAX_POINTS, r)) + 0 // + 0 turns −0 into 0
}

/**
 * points(j) = log2[((a_j+½)/(A+K/2)) / ((b_j+½)/(B+K/2))] − log2[((a_ref+½)/(A+K/2)) / ((b_ref+½)/(B+K/2))],
 * K = number of bins including the reference. Unsupported: a bin with a_j + b_j < 10 → 0;
 * a reference with a_ref < 5 or b_ref < 5 → every bin of the group 0.
 */
export function estimatePoints(bins: BinCount[], A: number, B: number): BinPoints[] {
  const refs = bins.filter((x) => x.isReference)
  if (refs.length !== 1)
    throw new Error(`a group needs exactly one reference bin, got ${refs.length}`)
  const ref = refs[0]
  const K = bins.length
  const logRatio = (a: number, b: number): number =>
    Math.log2((a + 0.5) / (A + K / 2) / ((b + 0.5) / (B + K / 2)))
  const refOk = ref.a >= MIN_REFERENCE_COUNT && ref.b >= MIN_REFERENCE_COUNT
  return bins.map((bin) => {
    const supported = refOk && (bin.isReference || bin.a + bin.b >= MIN_BIN_SUPPORT)
    const raw =
      supported && !bin.isReference
        ? logRatio(bin.a, bin.b) - logRatio(ref.a, ref.b)
        : supported
          ? 0
          : Number.NaN
    return { ...bin, raw, supported, points: supported ? roundPoints(raw) : 0 }
  })
}
