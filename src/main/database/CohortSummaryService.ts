/**
 * CohortSummaryService - Pre-computed cohort aggregation tables
 *
 * Manages rebuild and staleness of cohort_variant_summary and gene_burden_summary.
 * Called after import/delete operations to refresh cached aggregations.
 */

import type Database from 'better-sqlite3-multiple-ciphers'
import { mainLogger } from '../services/MainLogger'
import {
  REBUILD_VARIANT_SUMMARY_SQL,
  REBUILD_GENE_BURDEN_SQL,
  UPDATE_META_SQL,
  MARK_STALE_SQL,
  UPDATE_PER_CASE_ANNOTATION_FLAGS_SQL,
  INCREMENTAL_ADD_SQL,
  INCREMENTAL_REMOVE_SQL,
  CLEANUP_ZERO_CARRIERS_SQL,
  RECOMPUTE_ALL_FREQUENCIES_SQL
} from '../../shared/sql/cohort-summary-rebuild'

export interface CohortSummaryStatus {
  is_stale: boolean
  last_rebuilt_at: number
}

export class CohortSummaryService {
  private db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
  }

  /**
   * Rebuild both summary tables from the variants table.
   * Runs as a single transaction for atomicity.
   */
  rebuild(): void {
    const rebuildTransaction = this.db.transaction(() => {
      this.db.exec(REBUILD_VARIANT_SUMMARY_SQL)
      this.db.exec(UPDATE_PER_CASE_ANNOTATION_FLAGS_SQL)
      this.db.exec(REBUILD_GENE_BURDEN_SQL)
      this.db.exec(UPDATE_META_SQL)
    })

    rebuildTransaction()

    // Update query planner statistics (outside transaction)
    try {
      this.db.exec('ANALYZE cohort_variant_summary')
    } catch (e) {
      mainLogger.warn(
        'Failed to ANALYZE cohort_variant_summary: ' + (e instanceof Error ? e.message : String(e)),
        'CohortSummaryService'
      )
    }
    try {
      this.db.exec('ANALYZE gene_burden_summary')
    } catch (e) {
      mainLogger.warn(
        'Failed to ANALYZE gene_burden_summary: ' + (e instanceof Error ? e.message : String(e)),
        'CohortSummaryService'
      )
    }
  }

  /**
   * Incrementally add a single case's variants to the summary.
   * Much faster than full rebuild for single-case imports (~1,500 variants vs 200k).
   */
  incrementalAdd(caseId: number): void {
    const addTransaction = this.db.transaction(() => {
      this.db.prepare(INCREMENTAL_ADD_SQL).run(caseId)
      this.db.exec(RECOMPUTE_ALL_FREQUENCIES_SQL)
      this.db.exec(MARK_STALE_SQL) // gene_burden_summary not updated
    })
    addTransaction()

    try {
      this.db.exec('ANALYZE cohort_variant_summary')
    } catch (e) {
      mainLogger.warn(
        'Failed to ANALYZE cohort_variant_summary after incrementalAdd: ' +
          (e instanceof Error ? e.message : String(e)),
        'CohortSummaryService'
      )
    }
  }

  /**
   * Incrementally remove a single case's variants from the summary.
   * Must be called BEFORE the case is deleted (needs variants data).
   */
  incrementalRemove(caseId: number): void {
    const removeTransaction = this.db.transaction(() => {
      this.db.prepare(INCREMENTAL_REMOVE_SQL).run(caseId)
      this.db.exec(CLEANUP_ZERO_CARRIERS_SQL)
      this.db.exec(RECOMPUTE_ALL_FREQUENCIES_SQL)
      this.db.exec(MARK_STALE_SQL) // gene_burden_summary not updated
    })
    removeTransaction()

    try {
      this.db.exec('ANALYZE cohort_variant_summary')
    } catch (e) {
      mainLogger.warn(
        'Failed to ANALYZE cohort_variant_summary after incrementalRemove: ' +
          (e instanceof Error ? e.message : String(e)),
        'CohortSummaryService'
      )
    }
  }

  /**
   * Mark summary tables as stale.
   * Called before data-changing operations.
   */
  markStale(): void {
    this.db.exec(MARK_STALE_SQL)
  }

  /**
   * Get current staleness status.
   */
  getStatus(): CohortSummaryStatus {
    const staleRow = this.db
      .prepare("SELECT value FROM cohort_summary_meta WHERE key = 'is_stale'")
      .get() as { value: string } | undefined

    const rebuiltRow = this.db
      .prepare("SELECT value FROM cohort_summary_meta WHERE key = 'last_rebuilt_at'")
      .get() as { value: string } | undefined

    return {
      is_stale: staleRow?.value === '1',
      last_rebuilt_at: rebuiltRow ? parseInt(rebuiltRow.value, 10) : 0
    }
  }
}
