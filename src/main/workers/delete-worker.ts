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
    db.exec('DROP TRIGGER IF EXISTS variants_fts_ai')
    db.exec('DROP TRIGGER IF EXISTS variants_fts_ad')
    db.exec('DROP TRIGGER IF EXISTS variants_fts_au')

    let deleted: number

    if (msg.type === 'deleteAll') {
      const deleteAll = db.transaction(() => {
        return db!.prepare('DELETE FROM cases').run().changes
      })
      deleted = deleteAll()
    } else {
      const ids = msg.ids ?? []
      if (ids.length === 0) {
        restoreFts(db)
        const response: DeleteWorkerResponse = { type: 'complete', deleted: 0 }
        port.postMessage(response)
        return
      }
      const placeholders = ids.map(() => '?').join(',')
      const deleteBatch = db.transaction(() => {
        return db!.prepare(`DELETE FROM cases WHERE id IN (${placeholders})`).run(...ids).changes
      })
      deleted = deleteBatch()
    }

    restoreFts(db)

    const response: DeleteWorkerResponse = { type: 'complete', deleted }
    port.postMessage(response)
  } catch (error) {
    // Try to restore FTS triggers even on error
    if (db) {
      try {
        db.exec(createFTSTriggers)
      } catch {
        // best effort
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
      } catch {
        // best effort
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

function restoreFts(db: DatabaseType): void {
  try {
    db.exec("INSERT INTO variants_fts(variants_fts) VALUES('rebuild')")
  } catch {
    // best effort
  }
  try {
    db.exec(createFTSTriggers)
  } catch {
    // best effort
  }
  try {
    db.exec('ANALYZE')
  } catch {
    // best effort
  }
}
