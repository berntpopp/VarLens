/**
 * Shared database utility module for worker threads.
 *
 * Provides common openWorkerDatabase, openWorkerDatabaseReadOnly, rebuildFts,
 * and rebuildCohortSummary patterns used across import-worker.ts,
 * delete-worker.ts, and export-worker.ts.
 */
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { DATABASE_CONFIG } from '../../shared/config'
import { createFTSTriggers } from '../database/schema'
import {
  anyFtsTrigger,
  ensureExtensionFtsTriggers,
  indexFtsRowsAbove,
  rebuildAllFtsIndexes
} from '../database/fts-trigger-management'
import { assertNotHexLiteralKey } from '../database/sqlcipher-key-guard'
import {
  REBUILD_VARIANT_SUMMARY_SQL,
  UPDATE_PER_CASE_ANNOTATION_FLAGS_SQL,
  REBUILD_GENE_BURDEN_SQL,
  UPDATE_META_SQL,
  CHECK_TABLE_EXISTS_SQL
} from '../../shared/sql/cohort-summary-rebuild'

// TODO(Task 2.1): `import-pipeline.ts` re-exports and uses this const alongside
// its own inline teardown/restore copy of the FTS trigger logic. A follow-up
// commit should migrate that third copy to `fts-trigger-management` and then
// remove this constant. Kept in place for now to keep Task 2 scope contained.
export const DROP_FTS_TRIGGERS = `
  DROP TRIGGER IF EXISTS variants_fts_ai;
  DROP TRIGGER IF EXISTS variants_fts_ad;
  DROP TRIGGER IF EXISTS variants_fts_au;
`

/**
 * Open a database for import/write operations with aggressive performance pragmas.
 */
export function openWorkerDatabase(dbPath: string, encryptionKey?: string): DatabaseType {
  if (encryptionKey !== undefined && encryptionKey !== '') {
    assertNotHexLiteralKey(encryptionKey)
  }

  const db = new Database(dbPath)

  if (encryptionKey !== undefined && encryptionKey !== '') {
    const safeKey = encryptionKey.replace(/'/g, "''")
    db.pragma(`key='${safeKey}'`)
  }

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = OFF')
  db.pragma('synchronous = OFF')
  db.pragma(`busy_timeout = ${DATABASE_CONFIG.BUSY_TIMEOUT_MS}`)
  db.pragma(`cache_size = ${DATABASE_CONFIG.IMPORT_CACHE_SIZE_KB}`)
  // shortcut: SQLite3MC < 2.6.0 does not encrypt disk temp files; keep MEMORY when encrypted (#614).
  const isEncrypted = encryptionKey !== undefined && encryptionKey !== ''
  db.pragma(isEncrypted ? 'temp_store = MEMORY' : 'temp_store = DEFAULT')
  db.pragma(`mmap_size = ${DATABASE_CONFIG.MMAP_SIZE_BYTES}`)
  db.pragma('wal_autocheckpoint = 0')
  // Bounds the ANALYZE / PRAGMA optimize at session end, as on the main connection.
  db.pragma(`analysis_limit = ${DATABASE_CONFIG.ANALYSIS_LIMIT}`)

  return db
}

/**
 * Run a PASSIVE write-ahead log checkpoint. PASSIVE never waits for or blocks
 * a reader; whatever a reader still pins is picked up later.
 */
export function checkpointWal(db: DatabaseType): void {
  try {
    db.pragma('wal_checkpoint(PASSIVE)')
  } catch (e) {
    console.warn(
      '[worker-db] Failed to checkpoint WAL:',
      e instanceof Error ? e.message : String(e)
    )
  }
}

/**
 * Bound the write-ahead log of an import session. The session disables the
 * automatic checkpoint (see openWorkerDatabase), so without this the log keeps
 * every page version of every file until the final TRUNCATE — about 3 GiB for
 * 20 exomes, 3.5x the finished database.
 */
export function checkpointBetweenFiles(db: DatabaseType): void {
  checkpointWal(db)
}

/**
 * Open a database in read-only mode (for export operations).
 */
export function openWorkerDatabaseReadOnly(dbPath: string, encryptionKey?: string): DatabaseType {
  if (encryptionKey !== undefined && encryptionKey !== '') {
    assertNotHexLiteralKey(encryptionKey)
  }

  const db = new Database(dbPath, { readonly: true })

  if (encryptionKey !== undefined && encryptionKey !== '') {
    const safeKey = encryptionKey.replace(/'/g, "''")
    db.pragma(`key='${safeKey}'`)
  }

  return db
}

/**
 * Rebuild the FTS index, recreate triggers, run ANALYZE, and optimize the index.
 * Returns false on failure so the caller can keep its recovery state.
 *
 * The rebuild step delegates to `rebuildAllFtsIndexes` from the shared
 * `fts-trigger-management` module so every present FTS table (variants_fts
 * plus any v26 extension FTS tables) is rebuilt. The trigger creation step
 * uses `createFTSTriggers` directly — this function is called from paths
 * (delete-worker) that did not first tear down triggers via a capture, so
 * there is no snapshot to restore from and we fall back to the
 * "ensure triggers exist" semantics.
 */
export function rebuildFts(db: DatabaseType): boolean {
  try {
    rebuildAllFtsIndexes(db)
    db.exec(createFTSTriggers)
    ensureExtensionFtsTriggers(db)
    try {
      db.exec('ANALYZE')
    } catch (e) {
      console.warn(
        '[worker-db] Failed to ANALYZE during FTS rebuild:',
        e instanceof Error ? e.message : String(e)
      )
    }
    db.exec("INSERT INTO variants_fts(variants_fts) VALUES('optimize')")
    return true
  } catch (e) {
    console.warn(
      '[worker-db] Failed to rebuild FTS index:',
      e instanceof Error ? e.message : String(e)
    )
    return false
  }
}

/**
 * End of an import session whose FTS triggers were down: index only the rows
 * above `watermark` (null: rebuild the whole index) and restore the triggers.
 * A small session ends with a bounded PRAGMA optimize, not a full ANALYZE.
 * Returns true on success or false on failure.
 */
export function restoreFts(db: DatabaseType, watermark: number | null): boolean {
  // Triggers back mid-session (a concurrent delete or rebuild job): rows went
  // in or out by trigger, so the watermark no longer says what is indexed.
  if (watermark === null || anyFtsTrigger(db)) return rebuildFts(db)
  try {
    indexFtsRowsAbove(db, watermark)
    db.exec(createFTSTriggers)
    ensureExtensionFtsTriggers(db)
    db.pragma('optimize')
    return true
  } catch (e) {
    console.warn(
      '[worker-db] Failed to restore FTS index:',
      e instanceof Error ? e.message : String(e)
    )
    return false
  }
}

/**
 * Rebuild the cohort variant summary and gene burden summary tables.
 * Best-effort — summary can be rebuilt on next import/app start if this fails.
 */
export function rebuildCohortSummary(db: DatabaseType): void {
  try {
    const tableExists = db.prepare(CHECK_TABLE_EXISTS_SQL).get() as { c: number }
    if (tableExists.c === 0) return

    db.transaction(() => {
      db.exec(REBUILD_VARIANT_SUMMARY_SQL)
      // Per-case stars/comments/ACMG calls feed the same flags the annotation
      // triggers maintain; without this a rebuild silently clears them.
      db.exec(UPDATE_PER_CASE_ANNOTATION_FLAGS_SQL)
      db.exec(REBUILD_GENE_BURDEN_SQL)
      db.exec(UPDATE_META_SQL)
    })()

    db.exec('ANALYZE cohort_variant_summary')
    db.exec('ANALYZE gene_burden_summary')
  } catch (e) {
    console.warn(
      '[worker-db] Failed to rebuild cohort summary (will be rebuilt on next import/app start):',
      e instanceof Error ? e.message : String(e)
    )
  }
}
