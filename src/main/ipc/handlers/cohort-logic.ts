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
import type { RebuildWorkerResponse, RebuildPhase } from '../../workers/rebuild-summary-worker'
import type { StorageSession } from '../../storage/session'
import { AssociationEngine } from '../../statistics/AssociationEngine'
import { jobRunner } from '../../services/jobs/runner'
import { computePanelIntervals } from './panelIntervalHelper'
import { convertBigInts } from '../../utils/convertBigInts'
import type { ValidatedCohortSearchParams } from '../../../shared/types/ipc-schemas'
import type { AssociationConfig } from '../../statistics/types'

type GetSession = () => StorageSession

/** Progress payload emitted during a cohort summary rebuild. */
export interface CohortRebuildProgressData {
  phase: RebuildPhase
  phase_index: number
  phase_total: number
  label: string
}

/** Callbacks for emitting events to the renderer during cohort operations. */
export interface CohortCallbacks {
  onSummaryStale?: (data: { is_stale: boolean }) => void
  onSummaryFresh?: (data: { is_stale: boolean }) => void
  /**
   * Optional phase-progress callback. Fires between SQL statements inside
   * the rebuild worker — see `rebuild-summary-worker.ts` for the 3-phase
   * breakdown. If unset, progress events are silently dropped (worker keeps
   * sending them — the cost is a handful of postMessage calls per rebuild).
   */
  onSummaryProgress?: (data: CohortRebuildProgressData) => void
}

// Keep a reference for cancellation
let activeEngine: AssociationEngine | null = null

function getPostgresSession(getSession?: GetSession): StorageSession | undefined {
  if (getSession === undefined) return undefined

  const session = getSession()
  return session.capabilities.backend === 'postgres' ? session : undefined
}

/**
 * Spawn a worker thread to rebuild the cohort summary.
 * Returns a Promise that resolves on success and rejects on error.
 *
 * @param dbPath Absolute path to the SQLite database file
 * @param encryptionKey Optional DB encryption key
 * @param onProgress Optional callback fired on each phase boundary inside
 *   the worker. Unset = progress events silently dropped on the main side.
 *   Does NOT settle the Promise — only the terminal `complete` / `error`
 *   messages do that.
 */
export function spawnRebuildWorker(
  dbPath: string,
  encryptionKey?: string,
  onProgress?: (data: CohortRebuildProgressData) => void
): Promise<void> {
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
      if (msg.type === 'progress') {
        // Non-terminal — forward to caller, don't settle.
        onProgress?.({
          phase: msg.phase,
          phase_index: msg.phase_index,
          phase_total: msg.phase_total,
          label: msg.label
        })
        return
      }
      if (msg.type === 'complete') {
        settle()
        return
      }
      // type === 'error'
      settle(new Error(msg.error ?? 'Rebuild worker reported failure'))
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
 * Postgres-backed cohort variant query, executed via the storage read
 * executor. Shared by the desktop postgres branch and the web transport so
 * both run one implementation. Defaults `genome_build` to GRCh38 to match the
 * desktop SQLite/pool path's backward-compatibility behavior.
 */
export async function getCohortVariantsViaSession(
  params: ValidatedCohortSearchParams,
  getSession: () => StorageSession
): Promise<unknown> {
  const cohortParams = { ...params } as typeof params & { genome_build?: string }
  cohortParams.genome_build = cohortParams.genome_build ?? 'GRCh38'
  const result = await getSession()
    .getReadExecutor()
    .execute({ type: 'cohort:query', params: [cohortParams] })
  return convertBigInts(result)
}

/** Postgres-backed cohort column metadata via the storage read executor. */
export async function getCohortColumnMetaViaSession(
  getSession: () => StorageSession
): Promise<unknown> {
  return await getSession().getReadExecutor().execute({ type: 'cohort:columnMeta', params: [] })
}

/** Postgres-backed cohort summary via the storage read executor. */
export async function getCohortSummaryViaSession(
  getSession: () => StorageSession
): Promise<unknown> {
  const summary = await getSession()
    .getReadExecutor()
    .execute({ type: 'cohort:summary', params: [] })
  return convertBigInts(summary)
}

/** Postgres-backed cohort carriers for a variant via the storage read executor. */
export async function getCohortCarriersViaSession(
  chr: string,
  pos: number,
  ref: string,
  alt: string,
  getSession: () => StorageSession
): Promise<unknown> {
  const carriers = await getSession()
    .getReadExecutor()
    .execute({ type: 'cohort:carriers', params: [chr, pos, ref, alt] })
  return convertBigInts(carriers)
}

/** Postgres-backed cohort gene-burden via the storage read executor. */
export async function getCohortGeneBurdenViaSession(
  getSession: () => StorageSession
): Promise<unknown> {
  return await getSession().getReadExecutor().execute({ type: 'cohort:geneBurden', params: [] })
}

/** Postgres-backed cohort summary status via the storage read executor. */
export async function getCohortSummaryStatusViaSession(
  getSession: () => StorageSession
): Promise<unknown> {
  return await getSession().getReadExecutor().execute({ type: 'cohort:summaryStatus', params: [] })
}

/**
 * Query cohort variants with optional panel filtering.
 */
export async function queryCohortVariants(
  params: ValidatedCohortSearchParams,
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null,
  getSession?: GetSession
): Promise<unknown> {
  const postgresSession = getPostgresSession(getSession)
  if (postgresSession !== undefined) {
    return getCohortVariantsViaSession(params, () => postgresSession)
  }

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
      // Throws if the computation itself fails — never treat that as "no
      // panel configured" (see panelIntervalHelper.ts for the contract).
      const intervals = computePanelIntervals(
        dbRef,
        {
          active_panel_ids: cohortParams.active_panel_ids,
          panel_padding_bp: cohortParams.panel_padding_bp
        },
        undefined, // cohort mode: no specific case, sample any variant
        'cohort'
      )
      cohortParams.panel_intervals = intervals
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
  getDbPool?: () => DbPool | null,
  getSession?: GetSession
): Promise<unknown> {
  const postgresSession = getPostgresSession(getSession)
  if (postgresSession !== undefined) {
    return getCohortColumnMetaViaSession(() => postgresSession)
  }

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
  getDbPool?: () => DbPool | null,
  getSession?: GetSession
): Promise<unknown> {
  const postgresSession = getPostgresSession(getSession)
  if (postgresSession !== undefined) {
    return getCohortSummaryViaSession(() => postgresSession)
  }

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
  getDbPool?: () => DbPool | null,
  getSession?: GetSession
): Promise<unknown> {
  const postgresSession = getPostgresSession(getSession)
  if (postgresSession !== undefined) {
    return getCohortCarriersViaSession(chr, pos, ref, alt, () => postgresSession)
  }

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
  getDbPool?: () => DbPool | null,
  getSession?: GetSession
): Promise<unknown> {
  const postgresSession = getPostgresSession(getSession)
  if (postgresSession !== undefined) {
    return getCohortGeneBurdenViaSession(() => postgresSession)
  }

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
  // Validate no overlap between groups (preserved from pre-PR-4; runs before the
  // engine is constructed so a bad request never occupies the single-flight slot).
  const groupASet = new Set(config.groupA_ids)
  const overlap = config.groupB_ids.filter((id) => groupASet.has(id))
  if (overlap.length > 0) {
    throw new Error(`Groups overlap: case IDs ${overlap.join(', ')} appear in both groups`)
  }

  // Single-flight gating moves to the shared JobRunner (kind 'association').
  // The 'association' single-flight message in JobRunner is identical to the
  // pre-PR-4 guard text ('An association analysis is already running').
  const handle = jobRunner.enqueue<AssociationConfig, unknown>(
    'association',
    config,
    async (ctx) => {
      let engineRef: AssociationEngine | null = null
      // Cancellation chains to engine.abort() (Pass-9 #9 — NOT terminate()).
      ctx.registerCancel(() => engineRef?.abort())

      const db = getDb()
      const pool = getDbPool?.() ?? null

      engineRef = new AssociationEngine(
        db.database,
        (completed, total) => {
          onProgress?.({ completed, total })
        },
        pool
      )
      // Preserve the module-level reference so the existing
      // cohort:cancelAssociation IPC path keeps calling activeEngine.abort().
      activeEngine = engineRef

      try {
        const results = await engineRef.run(config)
        // Deep clone for IPC serialization
        return JSON.parse(JSON.stringify(results))
      } finally {
        activeEngine = null
      }
    }
  )

  return handle.result
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
  getDbPool?: () => DbPool | null,
  getSession?: GetSession
): Promise<unknown> {
  const postgresSession = getPostgresSession(getSession)
  if (postgresSession !== undefined) {
    return getCohortSummaryStatusViaSession(() => postgresSession)
  }

  const pool = getDbPool?.()
  if (pool) {
    return await pool.run({ type: 'cohort:summaryStatus', params: [] })
  }

  const db = getDb()
  return db.cohortSummary.getStatus()
}

/**
 * Rebuild the cohort summary, emitting stale/fresh/progress events via callbacks.
 */
export async function rebuildSummary(
  getDb: () => DatabaseService,
  callbacks: CohortCallbacks
): Promise<void> {
  const db = getDb()
  callbacks.onSummaryStale?.({ is_stale: true })
  await spawnRebuildWorker(db.getPath(), db.getEncryptionKey(), (progress) => {
    callbacks.onSummaryProgress?.(progress)
  })
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

  spawnRebuildWorker(db.getPath(), db.getEncryptionKey(), (progress) => {
    callbacks.onSummaryProgress?.(progress)
  })
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
