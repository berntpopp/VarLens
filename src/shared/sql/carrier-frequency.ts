/**
 * Cohort carrier frequency, one definition for both views and both backends
 * (#555, audit 09 Part 2): carriers ÷ the ready cases of the same genome
 * build that hold at least one call of the same variant class
 * (CARRIER_FREQUENCY_CLASSES). Carriers are the summary's `carrier_count`,
 * which counts carrier rows only (carrierRowSql). The case view reads the
 * same summary row, so case and cohort agree by construction.
 *
 * The class totals are one small GROUP BY per class over `cases` with an
 * EXISTS probe on `idx_variants_case_type` (case_id, variant_type): no table,
 * no migration. Pure SQL text, valid on SQLite and PostgreSQL.
 */
import { CARRIER_FREQUENCY_CLASSES } from '../config/domain.config'

const CLASSES = Object.entries(CARRIER_FREQUENCY_CLASSES)
const typeList = (types: readonly string[]): string => types.map((t) => `'${t}'`).join(', ')

/** The frequency class of variant_type column `column` (the type itself when in no class). */
export function variantClassSql(column: string): string {
  const arms = CLASSES.map(([cls, types]) => `WHEN ${column} IN (${typeList(types)}) THEN '${cls}'`)
  return `CASE ${arms.join(' ')} ELSE ${column} END`
}

export interface CarrierFrequencyRelations {
  /** Relation of the cases that count (alias `c` is applied here). */
  cases: string
  /** Relation of their variant rows (probed by case_id, variant_type). */
  variants: string
  /** Predicate on `c` that keeps the published cases; '' when `cases` is already filtered. */
  readyPredicate: string
}

/** Derived table `bt(build, vclass, total)`: per build and class, the cases holding a call of the class. */
export function classTotalsSql(rel: CarrierFrequencyRelations): string {
  const ready = rel.readyPredicate === '' ? '' : `${rel.readyPredicate} AND `
  return CLASSES.map(
    ([cls, types]) => `SELECT c.genome_build AS build, '${cls}' AS vclass, COUNT(*) AS total
          FROM ${rel.cases} c
          WHERE ${ready}EXISTS (
            SELECT 1 FROM ${rel.variants} cv
            WHERE cv.case_id = c.id AND cv.variant_type IN (${typeList(types)})
          )
          GROUP BY c.genome_build`
  ).join('\n        UNION ALL\n        ')
}

/** One row of {@link classTotalsSql}. */
export interface ClassTotal {
  build: string
  vclass: string
  total: number
}

const literal = (text: string): string => `'${text.replace(/'/g, "''")}'`

/**
 * {@link classTotalsSql} rows already computed, as a literal derived table:
 * the cached denominators inlined into a query, so it probes no case.
 */
export function classTotalsValuesSql(rows: readonly ClassTotal[]): string {
  if (rows.length === 0) {
    return 'SELECT CAST(NULL AS TEXT) AS build, CAST(NULL AS TEXT) AS vclass, CAST(NULL AS INTEGER) AS total WHERE 1 = 0'
  }
  return rows
    .map(
      (row) =>
        `SELECT ${literal(row.build)} AS build, ${literal(row.vclass)} AS vclass, ${Math.trunc(row.total)} AS total`
    )
    .join(' UNION ALL ')
}

/**
 * LEFT JOIN giving a row of build `buildExpr` and variant type `typeColumn`
 * its denominator as `bt.total` (and the build as `bt.build`). `totalsSql` is
 * {@link classTotalsSql} (live) or {@link classTotalsValuesSql} (cached).
 */
export function classTotalsJoinSql(
  totalsSql: string,
  buildExpr: string,
  typeColumn: string
): string {
  return `LEFT JOIN (
        ${totalsSql}
      ) bt ON ${classTotalsOnSql(buildExpr, typeColumn)}`
}

/** The ON condition of {@link classTotalsJoinSql}. */
export function classTotalsOnSql(buildExpr: string, typeColumn: string): string {
  return `bt.build = ${buildExpr} AND bt.vclass = ${variantClassSql(typeColumn)}`
}

/**
 * Carriers of case-view row `alias` in its case's build (`bt.build`, from
 * {@link classTotalsJoinSql}): the summary row's carrier_count, NULL when the
 * summary has none. A scalar probe on the summary's primary key, so the case
 * query gains no column that could make its unqualified names ambiguous.
 */
export function caseCarrierCountSql(summaryTable: string, alias: string): string {
  // `|| ''` keeps variant_type / genome_build out of any index: without
  // statistics (a fresh import) PostgreSQL otherwise probes idx_cvs_type_build,
  // which scans every row of the type and build for each variant. The primary
  // key prefix (chr, pos, ref, alt) is always selective.
  return `(SELECT s.carrier_count FROM ${summaryTable} s
    WHERE s.chr = ${alias}.chr AND s.pos = ${alias}.pos AND s.ref = ${alias}.ref
      AND s.alt = ${alias}.alt AND s.variant_type || '' = ${alias}.variant_type
      AND s.genome_build || '' = bt.build)`
}

/**
 * One build and one type selection select one denominator: a selected type
 * maps to one class (`snv` selects snv + indel, both "small").
 */
export function singleFrequencyDenominator(genomeBuild?: string, variantType?: string): boolean {
  return (genomeBuild ?? '') !== '' && (variantType ?? '') !== ''
}
