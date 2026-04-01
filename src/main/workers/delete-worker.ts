/**
 * Worker thread for bulk case deletion.
 *
 * Runs DELETE FROM cases in a separate thread so the main Electron
 * process stays responsive. Uses the same FTS trigger optimization
 * as CaseRepository (drop triggers, delete, rebuild, restore).
 */
import { parentPort } from 'worker_threads'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { DATABASE_CONFIG } from '../../shared/config'
import { createFTSTriggers } from '../database/schema'
import { MARK_STALE_SQL } from '../../shared/sql/cohort-summary-rebuild'
import { rebuildFts, rebuildCohortSummary, DROP_FTS_TRIGGERS } from './worker-db'
import { deleteAllCases, deleteCaseBatch } from './delete-operations'

export interface DeleteWorkerRequest {
  type: 'deleteAll' | 'deleteBatch'
  dbPath: string
  encryptionKey?: string
  ids?: number[]
}

export interface DeleteWorkerResponse {
  type: 'complete' | 'error'
  deleted?: number
  error?: string
}

if (!parentPort) throw new Error('Must be run as worker thread')

const port = parentPort

port.on('message', (msg: DeleteWorkerRequest) => {
  let db: DatabaseType | null = null

  try {
    db = openDatabase(msg.dbPath, msg.encryptionKey)

    // Drop FTS triggers before bulk delete
    db.exec(DROP_FTS_TRIGGERS)

    // Mark cohort summary as stale before delete
    try {
      db.exec(MARK_STALE_SQL)
    } catch (e) {
      console.warn(
        '[delete-worker] Failed to mark cohort summary as stale (table may not exist):',
        e instanceof Error ? e.message : String(e)
      )
    }

    let deleted: number

    if (msg.type === 'deleteAll') {
      deleted = deleteAllCases(db)
    } else {
      const ids = msg.ids ?? []
      if (ids.length === 0) {
        rebuildFts(db)
        const response: DeleteWorkerResponse = { type: 'complete', deleted: 0 }
        port.postMessage(response)
        return
      }
      deleted = deleteCaseBatch(db, ids)
    }

    rebuildFts(db)
    rebuildCohortSummary(db)

    const response: DeleteWorkerResponse = { type: 'complete', deleted }
    port.postMessage(response)
  } catch (error) {
    // Try to restore FTS triggers even on error
    if (db) {
      try {
        db.exec(createFTSTriggers)
      } catch (e) {
        console.warn(
          '[delete-worker] Failed to restore FTS triggers after error:',
          e instanceof Error ? e.message : String(e)
        )
      }
    }

    const response: DeleteWorkerResponse = {
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
          '[delete-worker] Failed to close database:',
          e instanceof Error ? e.message : String(e)
        )
      }
    }
  }
})

function openDatabase(dbPath: string, encryptionKey?: string): DatabaseType {
  const db = new Database(dbPath)

  if (encryptionKey !== undefined && encryptionKey !== '') {
    const safeKey = encryptionKey.split("'").join("''")
    db.pragma(`key='${safeKey}'`)
  }

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  db.pragma(`busy_timeout = ${DATABASE_CONFIG.BUSY_TIMEOUT_MS}`)
  db.pragma(`cache_size = ${DATABASE_CONFIG.CACHE_SIZE_KB}`)
  db.pragma('temp_store = MEMORY')
  db.pragma(`mmap_size = ${DATABASE_CONFIG.MMAP_SIZE_BYTES}`)

  return db
}
