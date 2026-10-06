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
import type { StorageReadTask } from '../../storage/read-executor'
import type { StorageSession } from '../../storage/session'
import type {
  DeleteWorkerRequest,
  DeleteWorkerResponse
} from '../../workers/delete-worker-protocol'
import { jobRunner } from '../../services/jobs/runner'
import type { JobHandle } from '../../services/jobs/JobRunner'
import type {
  CaseDeleteJobResult,
  CaseDeleteProgress,
  CaseDeleteTarget
} from '../../../shared/types/case-delete-job'
import type { AvailableBuild } from '../../../shared/types/database'
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

/** Delete worker outcome; `summaryStale` = a cancelled rebuild left the cohort summary stale. */
export interface SqliteDeleteWorkerResult extends CaseDeleteJobResult {
  summaryStale: boolean
}

/** Hooks for a running delete worker. */
export interface DeleteWorkerHooks {
  onProgress?: (progress: CaseDeleteProgress) => void
  /** Receives a function that asks the worker to stop between cases. */
  registerCancel?: (cancel: () => void) => void
  /** Override for tests; defaults to the bundled `delete-worker.js`. */
  workerPath?: string
}

/**
 * Run a delete job in a worker thread so the main process stays responsive.
 * Frequency upkeep, the per-case deletes and the FTS / cohort-summary
 * rebuilds all happen inside the worker.
 */
export function runDeleteWorker(
  request: Extract<DeleteWorkerRequest, { type: 'start' }>,
  hooks: DeleteWorkerHooks = {}
): Promise<SqliteDeleteWorkerResult> {
  return new Promise((res, rej) => {
    const workerPath = hooks.workerPath ?? resolve(__dirname, 'delete-worker.js')
    const worker = new Worker(workerPath)
    let settled = false

    const finish = (outcome: () => void): void => {
      if (settled) return
      settled = true
      outcome()
      worker.terminate().catch((e) => {
        mainLogger.warn(`Delete worker termination failed: ${e}`, 'cases')
      })
    }

    hooks.registerCancel?.(() => {
      if (!settled) worker.postMessage({ type: 'cancel' } satisfies DeleteWorkerRequest)
    })

    worker.on('message', (msg: DeleteWorkerResponse) => {
      if (msg.type === 'progress') {
        hooks.onProgress?.({ phase: msg.phase, current: msg.current, total: msg.total })
      } else if (msg.type === 'complete') {
        finish(() =>
          res({ deleted: msg.deleted, cancelled: msg.cancelled, summaryStale: msg.summaryStale })
        )
      } else {
        finish(() => rej(new Error(msg.error)))
      }
    })

    worker.on('error', (err: Error) => {
      mainLogger.error(`Delete worker error: ${err.message}`, 'cases')
      finish(() => rej(err))
    })

    worker.on('exit', (code) => {
      finish(() => rej(new Error(`Delete worker exited unexpectedly with code ${code}`)))
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
  getSession: () => StorageSession
): Promise<unknown> {
  const task: StorageReadTask = {
    type: 'cases:query',
    params: [params]
  }

  return await getSession().getReadExecutor().execute(task)
}

/**
 * Get distinct genome builds used across cases with per-build counts.
 * Used by the cohort view to populate the genome build selector.
 */
export async function getAvailableBuilds(
  getSession: () => StorageSession
): Promise<AvailableBuild[]> {
  const task: StorageReadTask = {
    type: 'cases:availableBuilds',
    params: []
  }

  return (await getSession().getReadExecutor().execute(task)) as AvailableBuild[]
}

class CaseDeleteCancelledError extends Error {
  constructor(readonly deleted: number) {
    super(`Case delete cancelled after ${deleted} case(s)`)
    this.name = 'AbortError'
  }
}

/**
 * Start a SQLite case delete as a tracked background job (`case_delete`).
 *
 * Returns synchronously with the job handle; the work runs in the delete
 * worker. Progress is published through the job (→ `jobs:changed`), and
 * `jobs:cancel` stops the worker between cases. Single-flight per kind is
 * enforced by the JobRunner, which throws if a delete is already running.
 */
export function startSqliteCaseDeleteJob(
  target: CaseDeleteTarget,
  getDb: () => DatabaseService,
  callbacks: DeleteCallbacks,
  options: { workerPath?: string } = {}
): JobHandle<CaseDeleteJobResult> {
  if (deleteInProgress) {
    throw new Error('A delete operation is already in progress. Please wait for it to finish.')
  }
  const db = getDb()
  const request: Extract<DeleteWorkerRequest, { type: 'start' }> = {
    type: 'start',
    mode: target.mode,
    dbPath: db.getPath(),
    encryptionKey: db.getEncryptionKey(),
    ...(target.mode === 'ids' ? { ids: target.ids } : {})
  }

  return jobRunner.enqueue<CaseDeleteTarget, CaseDeleteJobResult>(
    'case_delete',
    target,
    async (ctx) => {
      mainLogger.info(`Starting case delete job (${describeTarget(target)})`, 'cases')
      callbacks.onCohortStale?.({ is_stale: true })
      try {
        const result = await runDeleteWorker(request, {
          workerPath: options.workerPath,
          onProgress: (p) => ctx.reportProgress(p.current, p.total, p.phase),
          registerCancel: (cancel) => ctx.registerCancel(cancel)
        })
        callbacks.onDeleted?.({ deleted: result.deleted })
        callbacks.onCohortStale?.({ is_stale: result.summaryStale })
        if (result.cancelled) throw new CaseDeleteCancelledError(result.deleted)
        return { deleted: result.deleted, cancelled: result.cancelled }
      } catch (error) {
        if (!(error instanceof CaseDeleteCancelledError)) {
          mainLogger.error(
            `Case delete job failed: ${error instanceof Error ? error.message : error}`,
            'cases'
          )
        }
        throw error
      }
    }
  )
}

function describeTarget(target: CaseDeleteTarget): string {
  return target.mode === 'all' ? 'all cases' : `ids: ${target.ids.join(', ')}`
}

/** Delete a single case by ID (awaits the background job). */
export async function deleteSingleCase(
  id: number,
  getDb: () => DatabaseService,
  callbacks: DeleteCallbacks
): Promise<void> {
  await startSqliteCaseDeleteJob({ mode: 'ids', ids: [id] }, getDb, callbacks).result
}

/** Delete all cases in the database (awaits the background job). */
export async function deleteAllCases(
  getDb: () => DatabaseService,
  callbacks: DeleteCallbacks
): Promise<number> {
  return (await startSqliteCaseDeleteJob({ mode: 'all' }, getDb, callbacks).result).deleted
}

/** Delete a batch of cases by IDs (awaits the background job). */
export async function deleteBatchCases(
  ids: number[],
  getDb: () => DatabaseService,
  callbacks: DeleteCallbacks
): Promise<number> {
  return (await startSqliteCaseDeleteJob({ mode: 'ids', ids }, getDb, callbacks).result).deleted
}
