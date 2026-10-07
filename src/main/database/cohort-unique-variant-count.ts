/**
 * Exact maintained counter behind the "unique variants" tile (issue #460):
 * the number of distinct (chr, pos, ref, alt) in the workspace.
 *
 * `COUNT(*)` of cohort_variant_summary is not that number — the summary key
 * also carries variant_type and genome_build, so a coordinate present under
 * two types or builds has two rows — and the exact `COUNT` of distinct
 * coordinates scans the summary's primary key (measured: 28 ms at 337 k rows,
 * 56 ms at 842 k). The counter lives in `cohort_summary_meta` and moves in the same
 * transaction as the summary rows:
 *
 *  - full rebuilds recount it (UPDATE_META_SQL);
 *  - a case add increments it by the case's coordinates that had no summary
 *    row of any type or build before the merge;
 *  - a case removal decrements it by the case's coordinates that have no
 *    summary row left afterwards;
 *  - an annotation edit (transcript switch) recomputes rows of a coordinate
 *    that keeps its carriers, so the counter does not move;
 *  - migration v39 fills it.
 *
 * Readers trust it only while the summary is current: a stale summary (or a
 * database without the key) is counted directly instead.
 *
 * Runs inside worker threads: no MainLogger / Electron imports.
 */
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import {
  COUNT_UNIQUE_VARIANTS_SQL,
  UNIQUE_VARIANT_COUNT_KEY
} from '../../shared/sql/cohort-summary-rebuild'

const READ_SQL = `
  SELECT
    (SELECT value FROM cohort_summary_meta WHERE key = '${UNIQUE_VARIANT_COUNT_KEY}') AS counter,
    (SELECT value FROM cohort_summary_meta WHERE key = 'is_stale') AS stale`

const ADJUST_SQL = `
  UPDATE cohort_summary_meta SET value = CAST(CAST(value AS INTEGER) + CAST(@delta AS INTEGER) AS TEXT)
  WHERE key = '${UNIQUE_VARIANT_COUNT_KEY}'`

const HAS_SUMMARY_ROW = (alias: string): string =>
  `SELECT 1 FROM cohort_variant_summary s
        WHERE s.chr = ${alias}.chr AND s.pos = ${alias}.pos
          AND s.ref = ${alias}.ref AND s.alt = ${alias}.alt`

/**
 * Coordinates of the staged case (temp.added_case_coords) nobody had before.
 * Run after the staging and BEFORE the case's new rows are inserted.
 */
const COUNT_ADDED_SQL = `
  SELECT COUNT(*) AS c FROM (
    SELECT DISTINCT d.chr, d.pos, d.ref, d.alt FROM temp.added_case_coords d
    WHERE d.summary_rowid IS NULL AND NOT EXISTS (${HAS_SUMMARY_ROW('d')})
  )`

/**
 * Coordinates of the removed case (temp.removed_case_rows) nobody has any
 * more. Run AFTER the removal finished with the summary rows.
 */
const COUNT_REMOVED_SQL = `
  SELECT COUNT(*) AS c FROM (
    SELECT DISTINCT k.chr, k.pos, k.ref, k.alt FROM temp.removed_case_rows k
    WHERE NOT EXISTS (${HAS_SUMMARY_ROW('k')})
  )`

const count = (db: DatabaseType, sql: string): number => (db.prepare(sql).get() as { c: number }).c

function adjust(db: DatabaseType, delta: number): void {
  if (delta !== 0) db.prepare(ADJUST_SQL).run({ delta })
}

/** Distinct coordinates in the summary, counted directly (scans its primary key). */
export function countUniqueVariants(db: DatabaseType): number {
  return count(db, COUNT_UNIQUE_VARIANTS_SQL)
}

/** The tile value: the maintained counter, or a direct count when it cannot be trusted. */
export function readUniqueVariantCount(db: DatabaseType): number {
  const row = db.prepare(READ_SQL).get() as { counter: string | null; stale: string | null }
  if (row.counter === null || row.stale === '1') return countUniqueVariants(db)
  return Number(row.counter)
}

/** See COUNT_ADDED_SQL for when to call it. */
export function countAddedCaseUniqueVariants(db: DatabaseType): void {
  adjust(db, count(db, COUNT_ADDED_SQL))
}

/** See COUNT_REMOVED_SQL for when to call it. */
export function countRemovedCaseUniqueVariants(db: DatabaseType): void {
  adjust(db, -count(db, COUNT_REMOVED_SQL))
}
