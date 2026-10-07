/**
 * Interrupted imports on SQLite.
 *
 * The pipeline inserts a case 'provisional' and the import worker flips it to
 * 'ready' in the transaction that also counts its `variant_frequency` rows and
 * settles its cohort-summary state (import-worker.ts `publishCase`). A case
 * that is still provisional when no import is running therefore belongs to an
 * import that never finished — the worker or the app died, or the worker's own
 * cleanup of a failed file failed — and has contributed to neither table.
 *
 * Semantics mirror `recoverInterruptedImports` on PostgreSQL (a new case left
 * 'importing' is deleted with its rows): an interrupted import is discarded,
 * never completed or published. On SQLite that is a plain delete of the case
 * and its rows; frequencies and summary need no repair.
 *
 * `reportedCaseIds` is the older mechanism this extends: the case a crashed
 * worker was filling, named by the main process (`discardCaseIds`). The main
 * process reports that import as failed, so the case goes even if the worker
 * got as far as publishing it — then its frequencies are taken back here, and
 * the session rebuilds the summary (it forces a rebuild for reported cases).
 *
 * Only call this where no other import can be running: at the start of an
 * import session (imports are single-flight per process). Runs inside worker
 * threads: no MainLogger / Electron imports.
 */
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import type { VariantFrequencyService } from '../database/VariantFrequencyService'

/** `cases.import_status` of a case the import pipeline has not published yet. */
export const PROVISIONAL_CASES_SQL = "SELECT id FROM cases WHERE import_status = 'provisional'"

/** True when an import left a case behind that was never published. */
export function hasInterruptedImports(db: DatabaseType): boolean {
  return db.prepare(`${PROVISIONAL_CASES_SQL} LIMIT 1`).get() !== undefined
}

/**
 * Delete every provisional case and every reported case. Returns the ids
 * discarded. Each case goes in its own transaction: one that cannot be
 * deleted throws, and the caller's session fails before it imports anything
 * onto an unknown state.
 */
export function discardInterruptedImports(
  db: DatabaseType,
  reportedCaseIds: readonly number[],
  deleteCase: (caseId: number) => void,
  frequencies: Pick<VariantFrequencyService, 'decrementFrequencies'>
): number[] {
  const status = db.prepare('SELECT import_status FROM cases WHERE id = ?')
  const provisional = (db.prepare(PROVISIONAL_CASES_SQL).all() as Array<{ id: number }>).map(
    (row) => row.id
  )
  const discarded: number[] = []
  for (const caseId of new Set([...reportedCaseIds, ...provisional])) {
    const row = status.get(caseId) as { import_status: string } | undefined
    if (row === undefined) continue
    db.transaction(() => {
      // Published before the worker died: it is in the frequency counts.
      if (row.import_status === 'ready') frequencies.decrementFrequencies(caseId)
      deleteCase(caseId)
    }).immediate()
    discarded.push(caseId)
  }
  return discarded
}
