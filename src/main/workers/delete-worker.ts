/**
 * Worker thread for background case deletion.
 *
 * Runs the whole delete job off the Electron main thread: per-case deletes
 * (each in its own transaction together with the internal allele-frequency
 * decrement), then the FTS and cohort-summary rebuilds. Progress is posted
 * after every case and every phase; a `cancel` message stops the job between
 * cases (the loop yields to this worker's event loop after each case).
 */
import { parentPort } from 'worker_threads'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { DATABASE_CONFIG } from '../../shared/config'
import type { CaseDeletePhase } from '../../shared/types/case-delete-job'
import { createFTSTriggers } from '../database/schema'
import { assertNotHexLiteralKey } from '../database/sqlcipher-key-guard'
import { MARK_STALE_SQL } from '../../shared/sql/cohort-summary-rebuild'
import { rebuildFts, rebuildCohortSummary, DROP_FTS_TRIGGERS } from './worker-db'
import { deleteCasesIncrementally, listAllCaseIds } from './delete-operations'
import type { DeleteWorkerRequest, DeleteWorkerResponse } from './delete-worker-protocol'

export type { DeleteWorkerRequest, DeleteWorkerResponse } from './delete-worker-protocol'

if (!parentPort) throw new Error('Must be run as worker thread')

const port = parentPort
let cancelled = false

function post(msg: DeleteWorkerResponse): void {
  port.postMessage(msg)
}

function postPhase(phase: CaseDeletePhase, current: number, total: number): void {
  post({ type: 'progress', phase, current, total })
}

port.on('message', (msg: DeleteWorkerRequest) => {
  if (msg.type === 'cancel') {
    cancelled = true
    return
  }
  cancelled = false
  void runDelete(msg)
})

async function runDelete(msg: Extract<DeleteWorkerRequest, { type: 'start' }>): Promise<void> {
  let db: DatabaseType | null = null

  try {
    db = openDatabase(msg.dbPath, msg.encryptionKey)
    const ids = msg.mode === 'all' ? listAllCaseIds(db) : (msg.ids ?? [])

    // Drop FTS triggers before bulk delete; rebuilt once at the end.
    db.exec(DROP_FTS_TRIGGERS)
    markCohortSummaryStale(db)

    const result = await deleteCasesIncrementally(db, ids, {
      deletingAll: msg.mode === 'all',
      isCancelled: () => cancelled,
      onProgress: (current, total) => postPhase('deleting', current, total)
    })

    postPhase('rebuilding-search-index', result.deleted, ids.length)
    rebuildFts(db)
    postPhase('rebuilding-cohort-summary', result.deleted, ids.length)
    rebuildCohortSummary(db)
    postPhase('finalizing', result.deleted, ids.length)

    post({ type: 'complete', deleted: result.deleted, cancelled: result.cancelled })
  } catch (error) {
    if (db) restoreFtsTriggers(db)
    post({ type: 'error', error: error instanceof Error ? error.message : String(error) })
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
}

function markCohortSummaryStale(db: DatabaseType): void {
  try {
    db.exec(MARK_STALE_SQL)
  } catch (e) {
    console.warn(
      '[delete-worker] Failed to mark cohort summary as stale (table may not exist):',
      e instanceof Error ? e.message : String(e)
    )
  }
}

function restoreFtsTriggers(db: DatabaseType): void {
  try {
    db.exec(createFTSTriggers)
  } catch (e) {
    console.warn(
      '[delete-worker] Failed to restore FTS triggers after error:',
      e instanceof Error ? e.message : String(e)
    )
  }
}

function openDatabase(dbPath: string, encryptionKey?: string): DatabaseType {
  if (encryptionKey !== undefined && encryptionKey !== '') {
    assertNotHexLiteralKey(encryptionKey)
  }

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
