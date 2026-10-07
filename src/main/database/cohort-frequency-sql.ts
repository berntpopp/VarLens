/**
 * Cohort frequency of a `cohort_variant_summary` row on SQLite, derived at
 * read time: carriers over the number of cases of the row's genome build
 * (NULL when the build has no cases). Mirrors `SUMMARY_FREQUENCY_SQL` in
 * storage/postgres/postgres-cohort-summary-query.ts.
 *
 * The stored `cohort_frequency` column is no longer written: keeping it
 * current meant rewriting every summary row of a build whenever its case
 * count changed (every case deletion). Every reader goes through this module
 * so the expression exists once.
 *
 * Pure SQL text — safe to import from worker threads.
 */

/** Alias the summary table must have in a query that uses the frequency. */
export const COHORT_SUMMARY_ALIAS = 'cvs'

/** Bare column key under which filters and sorts name the frequency. */
export const COHORT_FREQUENCY_KEY = 'cohort_frequency'

/**
 * The frequency expression; needs {@link COHORT_BUILD_TOTALS_JOIN} in the FROM
 * clause. The outer CAST gives it REAL affinity, so a text parameter such as
 * `'0.5'` compares numerically, exactly as it did against the REAL column.
 */
export const COHORT_FREQUENCY_SQL = `CAST(CAST(${COHORT_SUMMARY_ALIAS}.carrier_count AS REAL) / NULLIF(bt.total, 0) AS REAL)`

/**
 * Gives every summary row (alias `cvs`) its build's case count as `bt.total`.
 * The subquery exposes the build as `bt.build`, so unqualified summary column
 * names (`genome_build` in the keyset order, …) stay unambiguous.
 */
export const COHORT_BUILD_TOTALS_JOIN = `LEFT JOIN (
        SELECT genome_build AS build, COUNT(*) AS total FROM cases WHERE import_status = 'ready' GROUP BY genome_build
      ) bt ON bt.build = ${COHORT_SUMMARY_ALIAS}.genome_build`

/** `FROM` body: the summary as `cvs` joined to the per-build case totals. */
export const COHORT_SUMMARY_WITH_FREQUENCY_FROM = `cohort_variant_summary ${COHORT_SUMMARY_ALIAS}
      ${COHORT_BUILD_TOTALS_JOIN}`

/**
 * SQL to sort, aggregate or list a cohort column by: the stored column, or the
 * read-time expression for the frequency. With a single genome build there is
 * one denominator, so the indexed carrier count orders the rows exactly as the
 * frequency would (and needs no arithmetic per row).
 */
export function cohortSortExpression(key: string, column: string, genomeBuild?: string): string {
  if (key !== COHORT_FREQUENCY_KEY) return column
  const singleBuild = genomeBuild !== undefined && genomeBuild !== ''
  return singleBuild ? 'carrier_count' : COHORT_FREQUENCY_SQL
}
