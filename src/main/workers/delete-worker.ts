/**
 * Worker thread for background case deletion.
 *
 * Runs the whole delete job off the Electron main thread. Each case is deleted
 * in its own transaction together with its internal allele-frequency
 * decrement, its FTS rows (row triggers) and its cohort-summary contribution
 * (incremental, see cohort-summary-case-removal.ts) -- no global FTS or
 * summary rebuild (audit 05, D-1). Delete-all, or a summary that was already
 * stale, ends with one chunked full summary rebuild. Progress is posted after
 * every case and phase; a `cancel` message stops the job between cases or
 * between chromosomes of the rebuild (which then rolls back, summary stale).
 */
import { parentPort } from 'worker_threads'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { DATABASE_CONFIG } from '../../shared/config'
import type { CaseDeletePhase } from '../../shared/types/case-delete-job'
import { createFTSTriggers } from '../database/schema'
import { assertNotHexLiteralKey } from '../database/sqlcipher-key-guard'
import { MARK_STALE_SQL } from '../../shared/sql/cohort-summary-rebuild'
import { rebuildCohortSummaryCancellable } from './cancellable-summary-rebuild'
import {
  deleteCasesIncrementally,
  listAllCaseIds,
  openSummaryRemovalForDelete
} from './delete-operations'
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
    const deletingAll = msg.mode === 'all'
    const ids = deletingAll ? listAllCaseIds(db) : (msg.ids ?? [])

    // FTS stays incremental: the row triggers delete each variant's index
    // entries as its case cascades away (no global 'rebuild', audit D-1).
    db.exec(createFTSTriggers)
    // Single/batch deletes patch the cohort summary per case inside the
    // delete transaction; delete-all, an already-stale summary and an open
    // import session fall back to one (cancellable) full rebuild at the end.
    const summary = openSummaryRemovalForDelete(db, deletingAll)
    if (summary === null) markCohortSummaryStale(db)

    const result = await deleteCasesIncrementally(db, ids, {
      deletingAll,
      summary,
      isCancelled: () => cancelled,
      onProgress: (current, total) => postPhase('deleting', current, total)
    })

    let summaryStale = false
    if (summary === null) {
      postPhase('rebuilding-cohort-summary', result.deleted, ids.length)
      const outcome = await rebuildCohortSummaryCancellable(db, () => cancelled)
      summaryStale = outcome === 'cancelled'
    }
    postPhase('finalizing', result.deleted, ids.length)
    optimizeAfterDelete(db)

    post({
      type: 'complete',
      deleted: result.deleted,
      cancelled: result.cancelled || cancelled,
      summaryStale
    })
  } catch (error) {
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

/** Bounded statistics refresh instead of the old whole-database ANALYZE. */
function optimizeAfterDelete(db: DatabaseType): void {
  try {
    db.pragma('analysis_limit = 1000')
    db.pragma('optimize')
  } catch (e) {
    console.warn(
      '[delete-worker] PRAGMA optimize failed:',
      e instanceof Error ? e.message : String(e)
    )
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
