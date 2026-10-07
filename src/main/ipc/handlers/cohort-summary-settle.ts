/**
 * Cohort-summary bookkeeping the main process owes the renderer after an
 * import on the SQLite backend.
 *
 * The import worker keeps `cohort_variant_summary` / `gene_burden_summary`
 * exact after every file (cohort-summary-case-add.ts), so an import no longer
 * flags the cohort stale. Two things remain for the main process:
 *
 *  - metadata it cached from the summary must be dropped whenever a file's
 *    contribution lands;
 *  - if the summary is nevertheless out of date at the end (the worker's
 *    upkeep fell back and its own rebuild failed, the worker died, or rows
 *    were appended to a case behind the summary's back), the renderer is told
 *    the truth and the existing rebuild worker repairs it.
 */
import { mainLogger } from '../../services/MainLogger'
import { formatErrorMessage } from '../../../shared/errors/format-error-message'
import { spawnRebuildWorker } from './cohort-logic'
import type { DatabaseService } from '../../database/DatabaseService'

/** Payload of the `cohort:summaryRebuilt` event (phase fields: rebuild progress). */
export interface CohortStaleEvent {
  is_stale: boolean
  phase?: string
  phase_index?: number
  phase_total?: number
  label?: string
}

export type EmitCohortStale = (event: CohortStaleEvent) => void

/** Runs a full summary rebuild; resolves once the summary is current. */
export type RebuildCohortSummary = typeof spawnRebuildWorker

/** Drop the cohort filter metadata cached from the summary tables. */
export function invalidateCohortReadCaches(db: DatabaseService): void {
  try {
    db.cohort.invalidateColumnMetaCache()
  } catch (e) {
    mainLogger.warn(
      `Failed to invalidate cohort column metadata: ${formatErrorMessage(e, 'unknown error')}`,
      'cohort'
    )
  }
}

/**
 * The summary as the database records it: flagged stale, or left behind by an
 * import session that never reached its orderly end. An unreadable state is
 * reported as current — there is nothing a rebuild could do about it here.
 */
export function cohortSummaryNeedsRebuild(db: DatabaseService): boolean {
  try {
    return db.cohortSummary.getStatus().is_stale || db.needsStartupRebuild()
  } catch (e) {
    mainLogger.warn(
      `Failed to read cohort summary status: ${formatErrorMessage(e, 'unknown error')}`,
      'cohort'
    )
    return false
  }
}

/**
 * Rebuild the summary with the rebuild worker, telling the renderer that it is
 * stale, how far the rebuild is, and that it is current again. Never rejects:
 * after a failed rebuild the summary stays flagged stale, which is what the
 * renderer was last told. Resolves to whether the summary is current.
 */
export async function rebuildCohortSummaryAndNotify(
  db: DatabaseService,
  emit: EmitCohortStale | undefined,
  rebuild: RebuildCohortSummary = spawnRebuildWorker
): Promise<boolean> {
  emit?.({ is_stale: true })
  try {
    await rebuild(db.getPath(), db.getEncryptionKey(), (progress) =>
      emit?.({ is_stale: true, ...progress })
    )
  } catch (e) {
    mainLogger.error(
      `Cohort summary rebuild after import failed: ${formatErrorMessage(e, 'unknown error')}`,
      'cohort'
    )
    return false
  }
  invalidateCohortReadCaches(db)
  emit?.({ is_stale: false })
  return true
}

/**
 * End of an import: drop cached metadata and, only if the summary really is
 * out of date, repair it. Emits nothing when the summary is current.
 */
export async function settleCohortSummaryAfterImport(
  db: DatabaseService,
  emit: EmitCohortStale | undefined,
  rebuild?: RebuildCohortSummary
): Promise<void> {
  invalidateCohortReadCaches(db)
  if (cohortSummaryNeedsRebuild(db)) await rebuildCohortSummaryAndNotify(db, emit, rebuild)
}

/**
 * Rows were added to an existing case outside the import worker (multi-file
 * append), so the summary no longer matches the variants: flag it and rebuild.
 */
export async function rebuildCohortSummaryAfterAppend(
  db: DatabaseService,
  emit: EmitCohortStale | undefined,
  rebuild?: RebuildCohortSummary
): Promise<void> {
  try {
    db.cohortSummary.markStale()
  } catch (e) {
    mainLogger.warn(
      `Failed to mark cohort summary stale: ${formatErrorMessage(e, 'unknown error')}`,
      'cohort'
    )
  }
  await rebuildCohortSummaryAndNotify(db, emit, rebuild)
}
