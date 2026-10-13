/**
 * Counts imported variants whose gnomAD AF lies outside the valid range
 * (N-cohort-1). The values are stored as they are; the import result reports
 * the count, next to the unranked ClinVar values (./unranked-clinvar.ts), so
 * the import summary can warn that frequency filters may hide those variants.
 */
import { ALLELE_FREQUENCY_RANGE } from '../../shared/config/import.config'

let outOfRange = 0

/** Note one row's gnomAD AF as it is written. */
export function noteGnomadAf(value: unknown): void {
  if (typeof value !== 'number') return
  if (value < ALLELE_FREQUENCY_RANGE.min || value > ALLELE_FREQUENCY_RANGE.max) outOfRange++
}

/** Forget what an earlier import counted. */
export function resetAfOutOfRange(): void {
  outOfRange = 0
}

/** The count since the last call (undefined when none), and start over. */
export function takeAfOutOfRange(): number | undefined {
  const count = outOfRange
  outOfRange = 0
  return count === 0 ? undefined : count
}
