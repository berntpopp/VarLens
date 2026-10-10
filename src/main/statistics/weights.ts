import { jStat } from 'jstat'
import type { WeightScheme } from './types'

/**
 * Variant weight from the ALT allele frequency `maf` among the analysed
 * samples and an optional CADD score. The Beta(1,25) weight is defined on the
 * minor allele frequency, so it is taken at min(p, 1 - p).
 */
export function computeWeight(scheme: WeightScheme, maf: number, cadd: number | null): number {
  if (scheme === 'uniform') return 1.0

  const minorAf = Math.max(1e-8, Math.min(maf, 1 - maf))
  const betaWeight = jStat.beta.pdf(minorAf, 1, 25)

  if (scheme === 'beta_maf') return betaWeight

  const caddFactor = cadd !== null ? Math.min(cadd / 40, 1.0) : 1.0
  return betaWeight * caddFactor
}

/**
 * Compute burden score for a sample: sum of weighted dosages.
 */
export function computeBurdenScore(
  dosages: number[],
  mafs: number[],
  cadds: (number | null)[],
  scheme: WeightScheme
): number {
  let burden = 0
  for (let i = 0; i < dosages.length; i++) {
    const w = computeWeight(scheme, mafs[i], cadds[i])
    burden += w * dosages[i]
  }
  return burden
}
