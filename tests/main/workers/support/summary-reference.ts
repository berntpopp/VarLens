/**
 * Reference for cohort-summary exactness tests: both summary tables as the
 * full rebuild (`CohortSummaryService.rebuild()`'s statements, including the
 * per-case annotation flags) would produce them, computed in a savepoint that
 * is rolled back so the database under test is left untouched.
 */
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import {
  REBUILD_GENE_BURDEN_SQL,
  REBUILD_VARIANT_SUMMARY_SQL,
  UPDATE_PER_CASE_ANNOTATION_FLAGS_SQL
} from '../../../../src/shared/sql/cohort-summary-rebuild'

export interface SummarySnapshot {
  variants: unknown[]
  genes: unknown[]
  /** The maintained unique-variant counter (cohort_summary_meta), null when absent. */
  uniqueVariants: number | null
}

/** Every column except the derived-at-read `cohort_frequency` and the gene `updated_at` clock. */
export function snapshotSummary(db: DatabaseType): SummarySnapshot {
  return {
    variants: db
      .prepare(
        `SELECT chr, pos, ref, alt, variant_type, genome_build, end_pos, gene_symbol, cdna,
           aa_change, consequence, func, clinvar, gnomad_af, cadd, transcript, omim_mim_number,
           carrier_count, het_count, hom_count, has_star, has_comment, acmg_best, variant_key
         FROM cohort_variant_summary
         ORDER BY chr, pos, ref, alt, variant_type, genome_build`
      )
      .all(),
    genes: db
      .prepare(
        `SELECT gene_symbol, genome_build, variant_count, unique_variant_count, affected_case_count
         FROM gene_burden_summary ORDER BY gene_symbol, genome_build`
      )
      .all(),
    uniqueVariants: storedUniqueVariants(db)
  }
}

function storedUniqueVariants(db: DatabaseType): number | null {
  const value = summaryMeta(db, 'unique_variant_count')
  return value === undefined ? null : Number(value)
}

/** Distinct coordinates counted from `variants`, independent of the summary. */
function uniqueVariantsFromVariants(db: DatabaseType): number {
  const row = db
    .prepare('SELECT COUNT(*) AS c FROM (SELECT DISTINCT chr, pos, ref, alt FROM variants)')
    .get() as { c: number }
  return row.c
}

export function referenceSummary(db: DatabaseType): SummarySnapshot {
  db.exec('SAVEPOINT summary_reference')
  try {
    db.exec(REBUILD_VARIANT_SUMMARY_SQL)
    db.exec(UPDATE_PER_CASE_ANNOTATION_FLAGS_SQL)
    db.exec(REBUILD_GENE_BURDEN_SQL)
    return { ...snapshotSummary(db), uniqueVariants: uniqueVariantsFromVariants(db) }
  } finally {
    db.exec('ROLLBACK TO summary_reference')
    db.exec('RELEASE summary_reference')
  }
}

export function summaryMeta(db: DatabaseType, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM cohort_summary_meta WHERE key = ?').get(key) as
    { value: string } | undefined
  return row?.value
}
