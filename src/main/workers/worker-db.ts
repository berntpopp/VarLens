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
  REBUILD_VARIANT_SUMMARY_SQL,
  REBUILD_GENE_BURDEN_SQL,
  UPDATE_META_SQL,
  CHECK_TABLE_EXISTS_SQL
} from '../../shared/sql/cohort-summary-rebuild'

export const DROP_FTS_TRIGGERS = `
  DROP TRIGGER IF EXISTS variants_fts_ai;
  DROP TRIGGER IF EXISTS variants_fts_ad;
  DROP TRIGGER IF EXISTS variants_fts_au;
`

/**
 * Open a database for import/write operations with aggressive performance pragmas.
 */
export function openWorkerDatabase(dbPath: string, encryptionKey?: string): DatabaseType {
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
  db.pragma('temp_store = MEMORY')
  db.pragma(`mmap_size = ${DATABASE_CONFIG.MMAP_SIZE_BYTES}`)
  db.pragma('wal_autocheckpoint = 0')

  return db
}

/**
 * Open a database in read-only mode (for export operations).
 */
export function openWorkerDatabaseReadOnly(dbPath: string, encryptionKey?: string): DatabaseType {
  const db = new Database(dbPath, { readonly: true })

  if (encryptionKey !== undefined && encryptionKey !== '') {
    const safeKey = encryptionKey.replace(/'/g, "''")
    db.pragma(`key='${safeKey}'`)
  }

  return db
}

/**
 * Rebuild the FTS index, recreate triggers, run ANALYZE, and optimize the index.
 * All steps are best-effort — failures are silently ignored.
 */
export function rebuildFts(db: DatabaseType): void {
  try {
    db.exec("INSERT INTO variants_fts(variants_fts) VALUES('rebuild')")
  } catch (e) {
    console.warn(
      '[worker-db] Failed to rebuild FTS index:',
      e instanceof Error ? e.message : String(e)
    )
  }
  try {
    db.exec(createFTSTriggers)
  } catch (e) {
    console.warn(
      '[worker-db] Failed to recreate FTS triggers:',
      e instanceof Error ? e.message : String(e)
    )
  }
  try {
    db.exec('ANALYZE')
  } catch (e) {
    console.warn('[worker-db] Failed to run ANALYZE:', e instanceof Error ? e.message : String(e))
  }
  try {
    db.exec("INSERT INTO variants_fts(variants_fts) VALUES('optimize')")
  } catch (e) {
    console.warn(
      '[worker-db] Failed to optimize FTS index:',
      e instanceof Error ? e.message : String(e)
    )
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
