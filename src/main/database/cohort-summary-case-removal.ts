/**
 * Incremental cohort-summary upkeep for a deleted case (audit 05, D-1).
 *
 * Deleting one case used to rebuild `cohort_variant_summary` and
 * `gene_burden_summary` from every remaining variant. This removes only the
 * deleted case's contribution, inside the case's delete transaction:
 *
 * Before the delete, the case's own per-coordinate contribution (its best row
 * by the representative order and its het/hom flag — the rebuild's per-case
 * step) and
 * its per-gene row counts/coordinates are copied into temp tables.
 *
 * After the delete:
 *  - variant summary: a row keeps its representative annotation unless the
 *    case's best row WAS the representative and no remaining carrier row equals
 *    it — then only carrier/het/hom counts are decremented (rows reaching 0
 *    carriers are dropped). Otherwise the coordinate is recomputed from the
 *    remaining variants with the full rebuild's own INSERT-SELECT, restricted
 *    by key, followed by the rebuild's per-case annotation flag step for those
 *    keys.
 *    The cohort frequency needs no upkeep although its denominator (the
 *    build's case count) changed: readers derive it (cohort-frequency-sql.ts).
 *  - gene burden: variant_count -= the case's rows, affected_case_count -= 1,
 *    unique_variant_count -= the case's coordinates no remaining variant of
 *    the same gene and build carries; rows reaching 0 are dropped.
 *
 * Every column therefore equals what a full rebuild would produce (asserted by
 * `tests/main/database/cohort-summary-case-removal.test.ts`, excluding the
 * gene `updated_at` timestamp). Only valid when the summary is current
 * beforehand: {@link openCaseSummaryRemoval} returns null for a stale or
 * missing summary and the caller falls back to a full rebuild.
 *
 * Runs inside worker threads: no MainLogger / Electron imports.
 */
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import {
  CHECK_TABLE_EXISTS_SQL,
  variantSummaryInsertSql
} from '../../shared/sql/cohort-summary-rebuild'
import {
  CASE_REMOVAL_TEMP_TABLES_SQL,
  CLEAR_TEMP_TABLES_SQL,
  prepareRemovalStatements
} from './cohort-summary-case-removal-sql'
import { countRemovedCaseUniqueVariants } from './cohort-unique-variant-count'

export interface CaseSummaryRemoval {
  /** Capture the case's contribution. Call inside the delete transaction, before the delete. */
  beforeDelete(caseId: number): void
  /** Remove the captured contribution. Call inside the same transaction, after the delete. */
  afterDelete(): void
}

/** True when `cohort_summary_meta.is_stale` says the summary needs a full rebuild. */
export function isCohortSummaryStale(db: DatabaseType): boolean {
  const row = db.prepare("SELECT value FROM cohort_summary_meta WHERE key = 'is_stale'").get() as
    { value: string } | undefined
  return row?.value === '1'
}

/**
 * Returns an incremental remover, or null when the summary tables are missing
 * (pre-v13 / partial test schema) or already stale (a full rebuild is needed
 * anyway, so patching stale rows would only hide that).
 */
export function openCaseSummaryRemoval(db: DatabaseType): CaseSummaryRemoval | null {
  const exists = db.prepare(CHECK_TABLE_EXISTS_SQL).get() as { c: number }
  if (exists.c === 0 || isCohortSummaryStale(db)) return null

  db.exec(CASE_REMOVAL_TEMP_TABLES_SQL)
  const s = prepareRemovalStatements(db, variantSummaryInsertSql)
  let genomeBuild: string | null = null

  return {
    beforeDelete(caseId) {
      db.exec(CLEAR_TEMP_TABLES_SQL)
      const row = s.caseBuild.get(caseId) as { genome_build: string | null } | undefined
      genomeBuild = row?.genome_build ?? null
      s.captureRows.run(caseId)
      s.captureGeneRows.run(caseId)
      s.captureGeneCoords.run(caseId)
    },
    afterDelete() {
      s.markRecompute.run()
      s.deleteRecomputeRows.run()
      s.decrementRows.run()
      s.dropEmptyRows.run()
      s.insertRecomputeRows.run()
      s.applyRecomputedPerCaseFlags.run()
      s.countLostGeneCoords.run({ build: genomeBuild })
      s.decrementGenes.run({ build: genomeBuild })
      s.dropEmptyGenes.run()
      countRemovedCaseUniqueVariants(db)
    }
  }
}
