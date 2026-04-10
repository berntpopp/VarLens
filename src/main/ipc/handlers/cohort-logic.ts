/**
 * Pure business logic for cohort IPC handlers.
 *
 * All functions take explicit dependencies (db, pool, callbacks) as parameters
 * and never touch IPC/Electron APIs directly. This makes them testable
 * without mocking Electron internals.
 */
import { Worker } from 'worker_threads'
import { resolve } from 'node:path'
import { mainLogger } from '../../services/MainLogger'
import type { CohortService } from '../../database/cohort'
import type { DatabaseService } from '../../database/DatabaseService'
import type { DbPool } from '../../database/DbPool'
import type { RebuildWorkerResponse } from '../../workers/rebuild-summary-worker'
import { AssociationEngine } from '../../statistics/AssociationEngine'
import { computePanelIntervals } from './panelIntervalHelper'
import { convertBigInts } from '../../utils/convertBigInts'
import type { ValidatedCohortSearchParams } from '../../../shared/types/ipc-schemas'
import type { AssociationConfig } from '../../statistics/types'

/** Callbacks for emitting events to the renderer during cohort operations. */
export interface CohortCallbacks {
  onSummaryStale?: (data: { is_stale: boolean }) => void
  onSummaryFresh?: (data: { is_stale: boolean }) => void
}

// Keep a reference for cancellation
let activeEngine: AssociationEngine | null = null

/**
 * Spawn a worker thread to rebuild the cohort summary.
 * Returns a Promise that resolves on success and rejects on error.
 */
export function spawnRebuildWorker(dbPath: string, encryptionKey?: string): Promise<void> {
  return new Promise<void>((promiseResolve: () => void, promiseReject: (err: Error) => void) => {
    const workerPath = resolve(__dirname, 'rebuild-summary-worker.js')
    const worker = new Worker(workerPath)
    let settled = false

    const settle = (err?: Error): void => {
      if (settled) return
      settled = true
      worker.terminate().catch((e) => {
        mainLogger.warn(`Summary rebuild worker termination failed: ${e}`, 'cohort')
      })
      if (err) {
        promiseReject(err)
      } else {
        promiseResolve()
      }
    }

    worker.on('message', (msg: RebuildWorkerResponse) => {
      if (msg.type === 'complete') {
        settle()
      } else {
        settle(new Error(msg.error ?? 'Rebuild worker reported failure'))
      }
    })

    worker.on('error', (err: Error) => {
      settle(err)
    })

    worker.on('exit', (code) => {
      if (!settled) {
        settle(new Error(`Rebuild worker exited unexpectedly with code ${code}`))
      }
    })

    worker.postMessage({ dbPath, encryptionKey })
  })
}

/**
 * Query cohort variants with optional panel filtering.
 */
export async function queryCohortVariants(
  params: ValidatedCohortSearchParams,
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<unknown> {
  const cohortParams = { ...params } as typeof params & {
    panel_intervals?: Array<{ chr: string; start: number; end: number }>
    genome_build?: string
    variant_type?: string
  }

  // Use client-provided build or default to GRCh38 for backward compatibility.
  // The renderer populates this from the cohort view's genome build selector,
  // which is seeded from cases:availableBuilds.
  cohortParams.genome_build = cohortParams.genome_build ?? 'GRCh38'

  const pool = getDbPool?.()

  if (cohortParams.active_panel_ids && cohortParams.active_panel_ids.length > 0) {
    if (pool) {
      // Pool path: let the worker resolve intervals off the main thread.
      // Panel interval resolution relies on genome_build being set above.
      // active_panel_ids and panel_padding_bp are forwarded as-is
    } else {
      // Fallback (no pool): compute panel intervals on the main thread
      const dbRef = getDb()
      const intervals = computePanelIntervals(
        dbRef,
        {
          active_panel_ids: cohortParams.active_panel_ids,
          panel_padding_bp: cohortParams.panel_padding_bp
        },
        undefined, // cohort mode: no specific case, sample any variant
        'cohort'
      )
      if (intervals) {
        cohortParams.panel_intervals = intervals
      }
      // Clean up IPC-only fields that shouldn't reach the service
      delete cohortParams.active_panel_ids
      delete cohortParams.panel_padding_bp
    }
  }

  let result: ReturnType<CohortService['getCohortVariants']>
  if (pool) {
    result = await pool.run({ type: 'cohort:variants', params: [cohortParams] })
  } else {
    const db = getDb()
    result = db.cohort.getCohortVariants(cohortParams)
  }
  return convertBigInts(result)
}

/**
 * Get column metadata for the cohort view.
 */
export async function getColumnMeta(
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<unknown> {
  const pool = getDbPool?.()
  if (pool) {
    return await pool.run({ type: 'cohort:columnMeta', params: [] })
  }

  const db = getDb()
  return db.cohort.getColumnMeta()
}

/**
 * Get the cohort summary.
 */
export async function getCohortSummary(
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<unknown> {
  const pool = getDbPool?.()
  let summary: ReturnType<CohortService['getCohortSummary']>
  if (pool) {
    summary = await pool.run({ type: 'cohort:summary', params: [] })
  } else {
    const db = getDb()
    summary = db.cohort.getCohortSummary()
  }
  // Convert BigInt values to Number for IPC serialization
  return convertBigInts(summary)
}

/**
 * Get carriers for a specific variant.
 */
export async function getCarriers(
  chr: string,
  pos: number,
  ref: string,
  alt: string,
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<unknown> {
  const pool = getDbPool?.()
  let carriers: ReturnType<CohortService['getCarriers']>
  if (pool) {
    carriers = await pool.run({
      type: 'cohort:carriers',
      params: [chr, pos, ref, alt]
    })
  } else {
    const db = getDb()
    carriers = db.cohort.getCarriers(chr, pos, ref, alt)
  }
  // Ensure data is serializable (convert any BigInt to Number)
  return convertBigInts(carriers)
}

/**
 * Get gene burden data.
 */
export async function getGeneBurden(
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<unknown> {
  const pool = getDbPool?.()
  if (pool) {
    return await pool.run({ type: 'cohort:geneBurden', params: [] })
  }

  const db = getDb()
  return db.cohort.getGeneBurden()
}

/**
 * Run a gene burden comparison (association analysis).
 * Takes a progress callback instead of using event.sender directly.
 */
export async function runGeneBurdenCompare(
  config: AssociationConfig,
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null,
  onProgress?: (data: { completed: number; total: number }) => void
): Promise<unknown> {
  // Prevent concurrent runs
  if (activeEngine !== null) {
    throw new Error('An association analysis is already running')
  }

  // Validate no overlap between groups
  const groupASet = new Set(config.groupA_ids)
  const overlap = config.groupB_ids.filter((id) => groupASet.has(id))
  if (overlap.length > 0) {
    throw new Error(`Groups overlap: case IDs ${overlap.join(', ')} appear in both groups`)
  }

  const db = getDb()
  const pool = getDbPool?.() ?? null

  activeEngine = new AssociationEngine(
    db.database,
    (completed, total) => {
      onProgress?.({ completed, total })
    },
    pool
  )

  try {
    const results = await activeEngine.run(config)
    // Deep clone for IPC serialization
    return JSON.parse(JSON.stringify(results))
  } finally {
    activeEngine = null
  }
}

/**
 * Cancel a running gene burden comparison.
 */
export function cancelGeneBurdenCompare(): void {
  if (activeEngine) {
    activeEngine.abort()
  }
}

/**
 * Get cohort summary status.
 */
export async function getSummaryStatus(
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<unknown> {
  const pool = getDbPool?.()
  if (pool) {
    return await pool.run({ type: 'cohort:summaryStatus', params: [] })
  }

  const db = getDb()
  return db.cohortSummary.getStatus()
}

/**
 * Rebuild the cohort summary, emitting stale/fresh events via callbacks.
 */
export async function rebuildSummary(
  getDb: () => DatabaseService,
  callbacks: CohortCallbacks
): Promise<void> {
  const db = getDb()
  callbacks.onSummaryStale?.({ is_stale: true })
  await spawnRebuildWorker(db.getPath(), db.getEncryptionKey())
  db.cohort.invalidateColumnMetaCache()
  callbacks.onSummaryFresh?.({ is_stale: false })
}

/**
 * Check if a startup rebuild is needed and spawn the worker if so.
 * Notifies via callbacks so the UI can show a progress indicator.
 */
export function triggerStartupRebuildIfNeeded(
  db: DatabaseService,
  callbacks: CohortCallbacks
): void {
  if (!db.needsStartupRebuild()) return

  mainLogger.info(
    'Startup: cohort summary empty with existing variants — spawning rebuild worker',
    'cohort'
  )
  callbacks.onSummaryStale?.({ is_stale: true })

  spawnRebuildWorker(db.getPath(), db.getEncryptionKey())
    .then(() => {
      mainLogger.info('Startup: cohort summary rebuild completed', 'cohort')
      try {
        db.cohort.invalidateColumnMetaCache()
      } catch (e) {
        mainLogger.warn(
          'Failed to invalidate column meta cache after startup rebuild (DB may be closed): ' +
            (e instanceof Error ? e.message : String(e)),
          'cohort'
        )
      }
      callbacks.onSummaryFresh?.({ is_stale: false })
    })
    .catch((err: Error) => {
      mainLogger.error(`Startup: cohort summary rebuild failed: ${err.message}`, 'cohort')
      // Leave is_stale: true so the user can trigger a manual rebuild
    })
}
