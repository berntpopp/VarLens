import { z } from 'zod'
import { BrowserWindow } from 'electron'
import { Worker } from 'worker_threads'
import { resolve } from 'node:path'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import { CohortService } from '../../database/cohort'
import { AssociationEngine } from '../../statistics/AssociationEngine'
import {
  CohortSearchParamsSchema,
  AssociationConfigSchema
} from '../../../shared/types/ipc-schemas'
import { mainLogger } from '../../services/MainLogger'
import type { RebuildWorkerResponse } from '../../workers/rebuild-summary-worker'
import type { DatabaseService } from '../../database/DatabaseService'

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

      const pool = getDbPool?.()
      let result: ReturnType<CohortService['getCohortVariants']>
      if (pool) {
        result = await pool.run({ type: 'cohort:variants', params: [validated.data] })
      } else {
        const db = getDb()
        const cohortService = new CohortService(db.database)
        result = cohortService.getCohortVariants(validated.data)
      }
      // Deep clone to plain object for IPC serialization
      // better-sqlite3 can return objects with non-serializable properties
      const plainData = result.data.map((v) => ({
        chr: String(v.chr),
        pos: Number(v.pos),
        ref: String(v.ref),
        alt: String(v.alt),
        gene_symbol: v.gene_symbol ?? null,
        cdna: v.cdna ?? null,
        aa_change: v.aa_change ?? null,
        carrier_count: Number(v.carrier_count),
        total_cases: Number(v.total_cases),
        cohort_frequency: Number(v.cohort_frequency),
        het_count: Number(v.het_count),
        hom_count: Number(v.hom_count),
        variant_key: String(v.variant_key),
        consequence: v.consequence ?? null,
        func: v.func ?? null,
        clinvar: v.clinvar ?? null,
        gnomad_af: v.gnomad_af !== null ? Number(v.gnomad_af) : null,
        cadd_phred: v.cadd_phred !== null ? Number(v.cadd_phred) : null,
        transcript: v.transcript ?? null,
        omim_id: v.omim_id ?? null
      }))
      return {
        data: plainData,
        total_count: Number(result.total_count)
      }
    })
  })

  ipcMain.handle('cohort:columnMeta', async (_event) => {
    return wrapHandler(async () => {
      const pool = getDbPool?.()
      if (pool) {
        return await pool.run({ type: 'cohort:columnMeta', params: [] })
      }

      const db = getDb()
      const cohortService = new CohortService(db.database)
      return cohortService.getColumnMeta()
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
        const cohortService = new CohortService(db.database)
        summary = cohortService.getCohortSummary()
      }
      // Ensure data is serializable (convert any BigInt to Number)
      return JSON.parse(
        JSON.stringify(summary, (_key, value) =>
          typeof value === 'bigint' ? Number(value) : value
        )
      )
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
          const cohortService = new CohortService(db.database)
          carriers = cohortService.getCarriers(
            validated.data.chr,
            validated.data.pos,
            validated.data.ref,
            validated.data.alt
          )
        }
        // Ensure data is serializable (convert any BigInt to Number)
        return JSON.parse(
          JSON.stringify(carriers, (_key, value) =>
            typeof value === 'bigint' ? Number(value) : value
          )
        )
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
      const cohortService = new CohortService(db.database)
      return cohortService.getGeneBurden()
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

      activeEngine = new AssociationEngine(db.database, (completed, total) => {
        event.sender.send('cohort:geneBurdenProgress', { completed, total })
      })

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
      db.cohortSummary.rebuild()
      safeEmit('cohort:summaryRebuilt', { is_stale: false })
    })
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

  const workerPath = resolve(__dirname, 'rebuild-summary-worker.js')
  const worker = new Worker(workerPath)
  let settled = false

  const settle = (): void => {
    if (settled) return
    settled = true
    worker.terminate().catch(() => {})
  }

  worker.on('message', (msg: RebuildWorkerResponse) => {
    if (msg.type === 'complete') {
      mainLogger.info('Startup: cohort summary rebuild completed', 'cohort')
      safeEmit('cohort:summaryRebuilt', { is_stale: false })
    } else {
      mainLogger.error(`Startup: cohort summary rebuild failed: ${msg.error}`, 'cohort')
      // Leave is_stale: true so the user can trigger a manual rebuild
    }
    settle()
  })

  worker.on('error', (err: Error) => {
    mainLogger.error(`Startup: rebuild worker error: ${err.message}`, 'cohort')
    settle()
  })

  worker.on('exit', (code) => {
    if (!settled) {
      mainLogger.error(`Startup: rebuild worker exited unexpectedly with code ${code}`, 'cohort')
    }
    settled = true
  })

  worker.postMessage({
    dbPath: db.getPath(),
    encryptionKey: db.getEncryptionKey()
  })
}
