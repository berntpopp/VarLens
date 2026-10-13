/**
 * PostgreSQL carrier-frequency SQL shared by the cohort summary reads and the
 * case view (split out of postgres-cohort-summary-query.ts).
 */
import {
  caseCarrierCountSql,
  classTotalsJoinSql,
  classTotalsSql,
  type CarrierFrequencyRelations
} from '../../../shared/sql/carrier-frequency'

/** Cohort carrier frequency of a summary row; needs `summaryBuildTotalsJoin` in the FROM clause. */
export const SUMMARY_FREQUENCY_SQL = '(cvs.carrier_count::double precision / NULLIF(bt.total, 0))'

/**
 * The cases (and their rows) the PostgreSQL carrier frequency counts: the
 * `cases` view hides cases that are still importing or being deleted, so the
 * probe can read `variants_all` directly. `tbl` qualifies a table name.
 */
export function postgresCarrierFrequencyRelations(
  tbl: (table: string) => string
): CarrierFrequencyRelations {
  return { cases: tbl('cases'), variants: tbl('variants_all'), readyPredicate: '' }
}

/**
 * The case view's carrier frequency (the cohort view's number): carriers of
 * row `v` from the summary, the frequency, and the denominator join keyed by
 * the build of case `caseIdParam` (a `$n` placeholder).
 */
export function caseCarrierFrequencySql(
  tbl: (table: string) => string,
  caseIdParam: string,
  totalsSql = liveCarrierTotalsSql(tbl)
): { carriers: string; frequency: string; totalsJoin: string } {
  const carriers = caseCarrierCountSql(tbl('cohort_variant_summary'), 'v')
  return {
    carriers,
    frequency: `(${carriers}::double precision / NULLIF(bt.total, 0))`,
    totalsJoin: classTotalsJoinSql(
      totalsSql,
      `(SELECT genome_build FROM ${tbl('cases')} WHERE id = ${caseIdParam})`,
      'v.variant_type'
    )
  }
}

/**
 * Join giving every summary row its carrier-frequency denominator as
 * `bt.total`: the visible cases of its build holding a call of its variant
 * class (src/shared/sql/carrier-frequency.ts).
 */
export function summaryBuildTotalsJoin(
  tbl: (table: string) => string,
  totalsSql = liveCarrierTotalsSql(tbl)
): string {
  return classTotalsJoinSql(totalsSql, 'cvs.genome_build', 'cvs.variant_type')
}

/** The denominators computed in the query itself (postgres-carrier-totals.ts caches them). */
export function liveCarrierTotalsSql(tbl: (table: string) => string): string {
  return classTotalsSql(postgresCarrierFrequencyRelations(tbl))
}
