import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'

import { isImportSessionOpen } from '../database/cohort-summary-case-add'
import { RECREATE_INDEXES } from './import-index-sql'
import { rebuildFts } from './worker-db'

export interface ImportFtsFinalizationState {
  ftsTriggersDropped: boolean
  ftsRebuilt: boolean
}

type RebuildFtsFn = (db: DatabaseType) => void
type CleanupFn = () => void
type PostMessageFn<T> = (message: T) => void

export function finalizeInterruptedImportFts(
  db: DatabaseType,
  state: ImportFtsFinalizationState,
  rebuild: RebuildFtsFn = rebuildFts
): boolean {
  if (!state.ftsTriggersDropped || state.ftsRebuilt) return false

  try {
    rebuild(db)
    state.ftsRebuilt = true
    return true
  } catch {
    return false
  }
}

/**
 * A session killed while "finalizing" has published its cases but never ran
 * its last steps: the indexes it dropped are missing and the FTS index does
 * not know the new cases (#505). Redo both when the open-session marker is
 * found; idempotent. Must run before a summary rebuild, which clears the marker.
 */
export function repairInterruptedImportSession(db: DatabaseType): boolean {
  if (!isImportSessionOpen(db)) return false
  db.exec(RECREATE_INDEXES)
  rebuildFts(db)
  return true
}

export function postTerminalMessageAfterCleanup<T>(
  terminalMessage: T | null | undefined,
  cleanup: CleanupFn,
  postMessage: PostMessageFn<T>
): void {
  cleanup()

  if (terminalMessage !== null && terminalMessage !== undefined) {
    postMessage(terminalMessage)
  }
}
