import { z } from 'zod'
import { BrowserWindow } from 'electron'
import { Worker } from 'worker_threads'
import { resolve } from 'node:path'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import type { CohortService } from '../../database/cohort'
import { AssociationEngine } from '../../statistics/AssociationEngine'
import {
  CohortSearchParamsSchema,
  AssociationConfigSchema
} from '../../../shared/types/ipc-schemas'
import { mainLogger } from '../../services/MainLogger'
import type { RebuildWorkerResponse } from '../../workers/rebuild-summary-worker'
import type { DatabaseService } from '../../database/DatabaseService'
import { computePanelIntervals } from './panelIntervalHelper'
import { convertBigInts } from '../../utils/convertBigInts'

function safeEmit(channel: string, data: unknown): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (win === undefined || win.isDestroyed()) return
  win.webContents.send(channel, data)
}

/**
 * Cohort IPC handlers
 * Channels: cohort:variants, cohort:summary, cohort:carriers,
 *           cohort:geneBurden, cohort:geneBurdenCompare, cohort:geneBurdenCancel
 */

// Schema for carriers query params
const CarriersParamsSchema = z.object({
  chr: z.string().min(1),
  pos: z.number().int().positive(),
  ref: z.string().min(1),
  alt: z.string().min(1)
})

// Keep a reference for cancellation
let activeEngine: AssociationEngine | null = null

export function registerCohortHandlers({ ipcMain, getDb, getDbPool }: HandlerDependencies): void {
  ipcMain.handle('cohort:variants', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = CohortSearchParamsSchema.safeParse(params)
      if (!validated.success) {
        mainLogger.error(`Invalid cohort:variants params: ${validated.error.message}`, 'cohort')
        throw new Error('Invalid search parameters')
      }

      const cohortParams = { ...validated.data } as typeof validated.data & {
        panel_intervals?: Array<{ chr: string; start: number; end: number }>
        genome_build?: string
      }

      const pool = getDbPool?.()

      if (cohortParams.active_panel_ids && cohortParams.active_panel_ids.length > 0) {
        if (pool) {
          // Pool path: let the worker resolve intervals off the main thread.
          // Cohort mode defaults to GRCh38 (no per-case genome build).
          cohortParams.genome_build = 'GRCh38'
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
    })
  })

  ipcMain.handle('cohort:columnMeta', async (_event) => {
    return wrapHandler(async () => {
      const pool = getDbPool?.()
      if (pool) {
        return await pool.run({ type: 'cohort:columnMeta', params: [] })
      }

      const db = getDb()
      return db.cohort.getColumnMeta()
    })
  })

  ipcMain.handle('cohort:summary', async (_event) => {
    return wrapHandler(async () => {
      const pool = getDbPool?.()
      let summary: ReturnType<CohortService['getCohortSummary']>
      if (pool) {
        summary = await pool.run({ type: 'cohort:summary', params: [] })
      } else {
        const db = getDb()
        summary = db.cohort.getCohortSummary()
      }
      // Convert BigInt values to Number for IPC serialization (avoids
      // double serialization via JSON.parse(JSON.stringify(...)))
      return convertBigInts(summary)
    })
  })

  ipcMain.handle(
    'cohort:carriers',
    async (_event, chr: unknown, pos: unknown, ref: unknown, alt: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validated = CarriersParamsSchema.safeParse({ chr, pos, ref, alt })
        if (!validated.success) {
          mainLogger.error(`Invalid cohort:carriers params: ${validated.error.message}`, 'cohort')
          throw new Error('Invalid carrier query parameters')
        }

        const pool = getDbPool?.()
        let carriers: ReturnType<CohortService['getCarriers']>
        if (pool) {
          carriers = await pool.run({
            type: 'cohort:carriers',
            params: [validated.data.chr, validated.data.pos, validated.data.ref, validated.data.alt]
          })
        } else {
          const db = getDb()
          carriers = db.cohort.getCarriers(
            validated.data.chr,
            validated.data.pos,
            validated.data.ref,
            validated.data.alt
          )
        }
        // Ensure data is serializable (convert any BigInt to Number)
        return convertBigInts(carriers)
      })
    }
  )

  ipcMain.handle('cohort:geneBurden', async (_event) => {
    return wrapHandler(async () => {
      const pool = getDbPool?.()
      if (pool) {
        return await pool.run({ type: 'cohort:geneBurden', params: [] })
      }

      const db = getDb()
      return db.cohort.getGeneBurden()
    })
  })

  ipcMain.handle('cohort:geneBurdenCompare', async (event, params: unknown) => {
    return wrapHandler(async () => {
      const validated = AssociationConfigSchema.safeParse(params)
      if (!validated.success) {
        mainLogger.error(`Invalid association config: ${validated.error.message}`, 'cohort')
        throw new Error('Invalid association analysis parameters')
      }

      // Prevent concurrent runs
      if (activeEngine !== null) {
        throw new Error('An association analysis is already running')
      }

      const config = validated.data

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
          event.sender.send('cohort:geneBurdenProgress', { completed, total })
        },
        pool
      )

      try {
        const results = await activeEngine.run(config)
        // Deep clone for IPC serialization – engine result may contain non-serializable properties
        return JSON.parse(JSON.stringify(results))
      } finally {
        activeEngine = null
      }
    })
  })

  ipcMain.handle('cohort:geneBurdenCancel', async () => {
    if (activeEngine) {
      // Only call abort(); the finally block in geneBurdenCompare clears activeEngine
      activeEngine.abort()
    }
  })

  // Summary status
  ipcMain.handle('cohort:summaryStatus', async () => {
    return wrapHandler(async () => {
      const pool = getDbPool?.()
      if (pool) {
        return await pool.run({ type: 'cohort:summaryStatus', params: [] })
      }

      const db = getDb()
      return db.cohortSummary.getStatus()
    })
  })

  // Manual rebuild trigger
  ipcMain.handle('cohort:rebuildSummary', async () => {
    return wrapHandler(async () => {
      const db = getDb()
      safeEmit('cohort:summaryRebuilt', { is_stale: true })
      await spawnRebuildWorker(db.getPath(), db.getEncryptionKey())
      db.cohort.invalidateColumnMetaCache()
      safeEmit('cohort:summaryRebuilt', { is_stale: false })
    })
  })
}

/**
 * Spawn a worker thread to rebuild the cohort summary.
 * Returns a Promise that resolves on success and rejects on error.
 */
function spawnRebuildWorker(dbPath: string, encryptionKey?: string): Promise<void> {
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
 * Spawn a worker thread to rebuild the cohort summary if the database
 * has variants but an empty summary table. Called once after handlers
 * are registered so the UI stays responsive during the rebuild.
 *
 * Notifies the renderer via `cohort:summaryRebuilt` before and after
 * the rebuild so the UI can show a progress indicator.
 */
export function triggerStartupRebuildIfNeeded(db: DatabaseService): void {
  if (!db.needsStartupRebuild()) return

  mainLogger.info(
    'Startup: cohort summary empty with existing variants — spawning rebuild worker',
    'cohort'
  )
  safeEmit('cohort:summaryRebuilt', { is_stale: true })

  spawnRebuildWorker(db.getPath(), db.getEncryptionKey())
    .then(() => {
      mainLogger.info('Startup: cohort summary rebuild completed', 'cohort')
      try {
        db.cohort.invalidateColumnMetaCache()
      } catch {
        /* DB may be closed */
      }
      safeEmit('cohort:summaryRebuilt', { is_stale: false })
    })
    .catch((err: Error) => {
      mainLogger.error(`Startup: cohort summary rebuild failed: ${err.message}`, 'cohort')
      // Leave is_stale: true so the user can trigger a manual rebuild
    })
}
