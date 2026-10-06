/**
 * SQLite migration v37: keyset index for the cohort view's default sort.
 *
 * `idx_cvs_carrier_keyset` is built on `cohortKeysetTerms('', 'sqlite')`, the
 * exact expression list the summary page query orders and seeks by
 * (src/shared/sql/cohort-keyset.ts), so `carrier_count DESC` pages are served
 * by an index walk and a cursor seek instead of a sort + OFFSET scan. It
 * replaces track 1's `idx_cvs_carrier_chr_rank` (v33), whose mixed-direction
 * order no query emits any more. PostgreSQL mirrors this in
 * `0021_cohort_keyset_index.sql`.
 */
import type Database from 'better-sqlite3-multiple-ciphers'
import { CHR_RANK_CVS_CARRIER_INDEX } from './chr-rank-indexes'
import { COHORT_KEYSET_INDEX, cohortKeysetTerms } from '../../shared/sql/cohort-keyset'

export const CREATE_COHORT_KEYSET_INDEX_SQL = `CREATE INDEX IF NOT EXISTS ${COHORT_KEYSET_INDEX} ON cohort_variant_summary(${cohortKeysetTerms('', 'sqlite').join(', ')})`

/** Migration v37 body. Idempotent; caller bumps user_version. */
export function migrateCohortKeysetIndex(db: Database.Database): void {
  const hasSummary =
    db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cohort_variant_summary'`
      )
      .get() !== undefined
  if (!hasSummary) return
  db.exec(CREATE_COHORT_KEYSET_INDEX_SQL)
  db.exec(`DROP INDEX IF EXISTS ${CHR_RANK_CVS_CARRIER_INDEX}`)
}
