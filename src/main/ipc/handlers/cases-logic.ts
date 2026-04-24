/**
 * Pure business logic for cases IPC handlers.
 *
 * All functions take explicit dependencies (db, callbacks) as parameters
 * and never touch IPC/Electron APIs directly. This makes them testable
 * without mocking Electron internals.
 */
import { Worker } from 'worker_threads'
import { resolve } from 'node:path'
import { mainLogger } from '../../services/MainLogger'
import type { DatabaseService } from '../../database/DatabaseService'
import type { DbPool } from '../../database/DbPool'
import type { StorageSession } from '../../storage/session'
import type { DeleteWorkerRequest, DeleteWorkerResponse } from '../../workers/delete-worker'
import type { ValidatedCaseSearchParams } from '../../../shared/types/ipc-schemas'

/** Callbacks for emitting events to the renderer during delete operations. */
export interface DeleteCallbacks {
  onDeleted?: (data: { deleted: number }) => void
  onCohortStale?: (data: { is_stale: boolean }) => void
}

// Guard against concurrent delete operations.
// SQLite is single-writer -- overlapping deletes cause "database is locked".
let deleteInProgress = false

/** Check and set the delete-in-progress lock. Returns true if lock was acquired. */
export function acquireDeleteLock(): boolean {
  if (deleteInProgress) return false
  deleteInProgress = true
  return true
}

/** Release the delete-in-progress lock. */
export function releaseDeleteLock(): void {
  deleteInProgress = false
}

/**
 * Run a delete operation in a worker thread to avoid blocking the main process.
 */
export function runDeleteWorker(request: DeleteWorkerRequest): Promise<number> {
  return new Promise((res, rej) => {
    const workerPath = resolve(__dirname, 'delete-worker.js')
    const worker = new Worker(workerPath)
    let settled = false

    const settle = (fn: typeof res | typeof rej, value: unknown): void => {
      if (settled) return
      settled = true
      fn(value as number)
      worker.terminate().catch((e) => {
        mainLogger.warn(`Delete worker termination failed: ${e}`, 'cases')
      })
    }

    worker.on('message', (msg: DeleteWorkerResponse) => {
      if (msg.type === 'complete') {
        settle(res, msg.deleted ?? 0)
      } else {
        settle(rej, new Error(msg.error ?? 'Delete worker failed'))
      }
    })

    worker.on('error', (err: Error) => {
      mainLogger.error(`Delete worker error: ${err.message}`, 'cases')
      settle(rej, err)
    })

    worker.on('exit', (code) => {
      settle(rej, new Error(`Delete worker exited unexpectedly with code ${code}`))
    })

    worker.postMessage(request)
  })
}

/**
 * List all cases through the active storage session.
 *
 * Backend-specific dispatch lives at the session layer so SQLite and PostgreSQL
 * can implement the slice differently without changing the IPC surface.
 */
export async function listCases(getSession: () => StorageSession): Promise<unknown> {
  return await getSession().listCases()
}

/**
 * Query cases with search/sort/pagination parameters.
 */
export async function queryCases(
  params: ValidatedCaseSearchParams,
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<unknown> {
  const pool = getDbPool?.()
  if (pool) {
    return await pool.run({ type: 'cases:query', params: [params] })
  }
  const db = getDb()
  return db.cases.queryCases(params)
}

/**
 * Get distinct genome builds used across cases with per-build counts.
 * Used by the cohort view to populate the genome build selector.
 */
export async function getAvailableBuilds(
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<Array<{ build: string; caseCount: number }>> {
  const pool = getDbPool?.()
  if (pool) {
    return (await pool.run({ type: 'cases:availableBuilds', params: [] })) as Array<{
      build: string
      caseCount: number
    }>
  }
  const db = getDb()
  return db.cases.getAvailableGenomeBuilds()
}

/**
 * Delete a single case by ID.
 * Decrements frequencies before deletion and recomputes on failure.
 */
export async function deleteSingleCase(
  id: number,
  getDb: () => DatabaseService,
  callbacks: DeleteCallbacks
): Promise<void> {
  if (!acquireDeleteLock()) {
    mainLogger.warn(`Delete already in progress, rejecting delete for case ${id}`, 'cases')
    throw new Error('A delete operation is already in progress. Please wait for it to finish.')
  }

  const db = getDb()
  mainLogger.info(`Starting single-case delete worker (id: ${id})`, 'cases')
  callbacks.onCohortStale?.({ is_stale: true })

  try {
    // Decrement frequencies BEFORE worker delete -- needs variant data still present.
    // This is a fast indexed operation (stays on main thread).
    try {
      db.variants.decrementFrequencies(id)
    } catch (freqError) {
      mainLogger.warn(`Failed to decrement variant frequencies: ${freqError}`, 'cases')
    }

    await runDeleteWorker({
      type: 'deleteBatch',
      dbPath: db.getPath(),
      encryptionKey: db.getEncryptionKey(),
      ids: [id]
    })

    callbacks.onDeleted?.({ deleted: 1 })
    callbacks.onCohortStale?.({ is_stale: false })
  } catch (error) {
    mainLogger.error(
      `Single-case delete worker failed: ${error instanceof Error ? error.message : error}`,
      'cases'
    )
    // Recovery: frequencies were decremented before the worker ran.
    // Recompute to correct any drift from the failed delete.
    try {
      db.variants.recomputeAllFrequencies()
    } catch (e) {
      mainLogger.warn(
        'Failed to recompute frequencies after delete failure: ' +
          (e instanceof Error ? e.message : String(e)),
        'cases'
      )
    }
    throw error
  } finally {
    releaseDeleteLock()
  }
}

/**
 * Delete all cases in the database.
 */
export async function deleteAllCases(
  getDb: () => DatabaseService,
  callbacks: DeleteCallbacks
): Promise<number> {
  if (!acquireDeleteLock()) {
    mainLogger.warn('Delete already in progress, rejecting deleteAll', 'cases')
    throw new Error('A delete operation is already in progress. Please wait for it to finish.')
  }

  const db = getDb()
  mainLogger.info(`Starting deleteAll worker (db: ${db.getPath()})`, 'cases')
  callbacks.onCohortStale?.({ is_stale: true })

  try {
    const deleted = await runDeleteWorker({
      type: 'deleteAll',
      dbPath: db.getPath(),
      encryptionKey: db.getEncryptionKey()
    })
    mainLogger.info(`deleteAll completed: ${deleted} cases deleted`, 'cases')

    // Recompute variant frequencies after bulk deletion
    try {
      db.variants.recomputeAllFrequencies()
    } catch (freqError) {
      mainLogger.warn(`Failed to recompute variant frequencies: ${freqError}`, 'cases')
    }

    callbacks.onDeleted?.({ deleted })
    callbacks.onCohortStale?.({ is_stale: false })
    return deleted
  } catch (error) {
    mainLogger.error(
      `deleteAll worker failed: ${error instanceof Error ? error.message : error}`,
      'cases'
    )
    throw error
  } finally {
    releaseDeleteLock()
  }
}

/**
 * Delete a batch of cases by IDs.
 */
export async function deleteBatchCases(
  ids: number[],
  getDb: () => DatabaseService,
  callbacks: DeleteCallbacks
): Promise<number> {
  if (!acquireDeleteLock()) {
    mainLogger.warn('Delete already in progress, rejecting deleteBatch', 'cases')
    throw new Error('A delete operation is already in progress. Please wait for it to finish.')
  }

  const db = getDb()
  callbacks.onCohortStale?.({ is_stale: true })

  try {
    const deleted = await runDeleteWorker({
      type: 'deleteBatch',
      dbPath: db.getPath(),
      encryptionKey: db.getEncryptionKey(),
      ids
    })

    // Recompute variant frequencies after batch deletion
    try {
      db.variants.recomputeAllFrequencies()
    } catch (freqError) {
      mainLogger.warn(`Failed to recompute variant frequencies: ${freqError}`, 'cases')
    }

    callbacks.onDeleted?.({ deleted })
    callbacks.onCohortStale?.({ is_stale: false })
    return deleted
  } catch (error) {
    mainLogger.error(
      `deleteBatch worker failed: ${error instanceof Error ? error.message : error}`,
      'cases'
    )
    throw error
  } finally {
    releaseDeleteLock()
  }
}
