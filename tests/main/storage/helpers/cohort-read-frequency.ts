/**
 * Cohort frequency is not stored on `cohort_variant_summary`; readers derive
 * it. Tests that need the value use the production expression and join, so
 * they assert what the cohort view actually shows.
 */
import {
  SUMMARY_FREQUENCY_SQL,
  summaryBuildTotalsJoin
} from '../../../../src/main/storage/postgres/postgres-cohort-summary-query'

/** `FROM` clause: the summary as `cvs` plus the per-build case totals. */
export function summaryWithFrequencyFrom(schema: string): string {
  return `"${schema}".cohort_variant_summary cvs ${summaryBuildTotalsJoin(`"${schema}".cases`)}`
}

/** Select-list item yielding the read-time frequency as `cohort_frequency`. */
export const COHORT_FREQUENCY_SELECT = `${SUMMARY_FREQUENCY_SQL} AS cohort_frequency`
