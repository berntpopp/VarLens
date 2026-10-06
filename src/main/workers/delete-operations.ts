import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { VariantFrequencyService } from '../database/VariantFrequencyService'

/**
 * Delete operations extracted from delete-worker for testability.
 * Accept an opened DB connection — caller manages lifecycle.
 */

export interface IncrementalDeleteOptions {
  /**
   * When true the caller is deleting every case: per-case frequency
   * decrements are skipped and the frequency table is cleared (or recomputed
   * after a cancel) once at the end.
   */
  deletingAll: boolean
  /** Polled between cases; returning true stops before the next case. */
  isCancelled: () => boolean
  /** Called after each case with (deletedSoFar, total). */
  onProgress: (current: number, total: number) => void
}

export interface IncrementalDeleteResult {
  deleted: number
  cancelled: boolean
}

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/** Ids of every case, used to drive a cancellable delete-all. */
export function listAllCaseIds(db: DatabaseType): number[] {
  return (db.prepare('SELECT id FROM cases ORDER BY id').all() as { id: number }[]).map(
    (row) => row.id
  )
}

/**
 * Delete cases one transaction per case, keeping `variant_frequency`
 * consistent inside the same transaction as the delete. Yields to the worker
 * event loop between cases so a `cancel` message can be observed, which makes
 * the job cancellable at case granularity (every committed case is complete:
 * its variants, annotations and frequency contribution are gone together).
 */
export async function deleteCasesIncrementally(
  db: DatabaseType,
  caseIds: readonly number[],
  options: IncrementalDeleteOptions
): Promise<IncrementalDeleteResult> {
  const frequencies = new VariantFrequencyService(db)
  const deleteCase = db.prepare('DELETE FROM cases WHERE id = ?')
  const deleteOne = db.transaction((caseId: number): number => {
    if (!options.deletingAll) frequencies.decrementFrequencies(caseId, false)
    return deleteCase.run(caseId).changes
  })

  let deleted = 0
  let cancelled = false
  options.onProgress(0, caseIds.length)

  for (const [index, caseId] of caseIds.entries()) {
    if (options.isCancelled()) {
      cancelled = true
      break
    }
    deleted += deleteOne(caseId)
    options.onProgress(index + 1, caseIds.length)
    await yieldToEventLoop()
  }

  if (options.deletingAll) {
    // All cases gone → empty table; a cancelled delete-all must recount.
    if (cancelled) frequencies.recomputeAllFrequencies()
    else frequencies.clearAll()
  } else {
    frequencies.pruneZeroCounts()
  }

  return { deleted, cancelled }
}
