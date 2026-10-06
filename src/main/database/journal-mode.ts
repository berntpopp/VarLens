/**
 * Journal-mode and key-literal helpers shared by connection setup, the
 * plaintext → encrypted migration and the live re-key.
 *
 * No MainLogger / Electron imports: also loaded inside worker threads.
 */
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'

/** Escape a value for use inside a single-quoted SQL literal (`key='…'`). */
export function quoteSqlLiteral(value: string): string {
  return value.split("'").join("''")
}

/**
 * Ask for `journal_mode = DELETE` and return the mode SQLite actually ended up
 * in. SQLite reports the RESULTING mode (it cannot leave WAL while another
 * connection has the file open), so callers must compare the return value
 * rather than trust the pragma.
 */
export function requestDeleteJournalMode(db: DatabaseType): string {
  return db.pragma('journal_mode = DELETE', { simple: true }) as string
}

export interface RekeyOutcome {
  /** False when the key changed but the connection could not return to WAL. */
  walRestored: boolean
}

/**
 * `PRAGMA rekey` on a connection that may be in WAL mode.
 *
 * sqlite3mc refuses to re-key in WAL ("Rekeying is not supported in WAL
 * journal mode"), so a WAL connection is checkpointed, switched to DELETE for
 * the rewrite and switched back afterwards — on success AND on failure. Leaving
 * WAL needs this to be the only open connection; the caller is responsible for
 * closing every other one first.
 *
 * Throws if the key was NOT changed. Never includes the key in an error.
 */
export function rekeyConnection(db: DatabaseType, newKey: string): RekeyOutcome {
  const wasWal = (db.pragma('journal_mode', { simple: true }) as string) === 'wal'

  if (wasWal) {
    db.pragma('wal_checkpoint(TRUNCATE)')
    const mode = requestDeleteJournalMode(db)
    if (mode !== 'delete') {
      throw new Error(`Could not leave WAL mode for the re-key (journal_mode is '${mode}')`)
    }
  }

  try {
    db.pragma(`rekey='${quoteSqlLiteral(newKey)}'`)
  } catch (error) {
    if (wasWal) restoreWal(db)
    throw error
  }

  return { walRestored: !wasWal || restoreWal(db) }
}

function restoreWal(db: DatabaseType): boolean {
  try {
    return (db.pragma('journal_mode = WAL', { simple: true }) as string) === 'wal'
  } catch {
    // The caller decides how to report it; the re-key outcome stands either way.
    return false
  }
}
