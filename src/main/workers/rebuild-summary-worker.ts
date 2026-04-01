/**
 * Short-lived worker thread for deferred cohort summary rebuild.
 *
 * Spawned after single case deletes to avoid blocking the main thread.
 * Opens its own database connection, rebuilds summary tables, then exits.
 */
import { parentPort } from 'worker_threads'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { DATABASE_CONFIG } from '../../shared/config'
import {
  REBUILD_VARIANT_SUMMARY_SQL,
  REBUILD_GENE_BURDEN_SQL,
  UPDATE_META_SQL
} from '../../shared/sql/cohort-summary-rebuild'

export interface RebuildWorkerRequest {
  dbPath: string
  encryptionKey?: string
}

export interface RebuildWorkerResponse {
  type: 'complete' | 'error'
  error?: string
}

if (!parentPort) throw new Error('Must be run as worker thread')

const port = parentPort

port.on('message', (msg: RebuildWorkerRequest) => {
  let db: DatabaseType | null = null
  try {
    db = new Database(msg.dbPath)

    if (msg.encryptionKey !== undefined && msg.encryptionKey !== '') {
      const safeKey = msg.encryptionKey.split("'").join("''")
      db.pragma(`key='${safeKey}'`)
    }

    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.pragma('synchronous = NORMAL')
    db.pragma(`busy_timeout = ${DATABASE_CONFIG.BUSY_TIMEOUT_MS}`)
    db.pragma(`cache_size = ${DATABASE_CONFIG.CACHE_SIZE_KB}`)
    db.pragma('temp_store = MEMORY')
    db.pragma(`mmap_size = ${DATABASE_CONFIG.MMAP_SIZE_BYTES}`)

    db.transaction(() => {
      db!.exec(REBUILD_VARIANT_SUMMARY_SQL)
      db!.exec(REBUILD_GENE_BURDEN_SQL)
      db!.exec(UPDATE_META_SQL)
    })()

    try {
      db.exec('ANALYZE cohort_variant_summary')
    } catch (e) {
      console.warn(
        '[rebuild-summary-worker] Failed to ANALYZE cohort_variant_summary:',
        e instanceof Error ? e.message : String(e)
      )
    }
    try {
      db.exec('ANALYZE gene_burden_summary')
    } catch (e) {
      console.warn(
        '[rebuild-summary-worker] Failed to ANALYZE gene_burden_summary:',
        e instanceof Error ? e.message : String(e)
      )
    }

    const response: RebuildWorkerResponse = { type: 'complete' }
    port.postMessage(response)
  } catch (error) {
    const response: RebuildWorkerResponse = {
      type: 'error',
      error: error instanceof Error ? error.message : String(error)
    }
    port.postMessage(response)
  } finally {
    if (db) {
      try {
        db.close()
      } catch (e) {
        console.warn(
          '[rebuild-summary-worker] Failed to close database:',
          e instanceof Error ? e.message : String(e)
        )
      }
    }
  }
})
