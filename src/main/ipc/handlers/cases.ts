import { z } from 'zod'
import { Worker } from 'worker_threads'
import { BrowserWindow } from 'electron'
import { resolve } from 'node:path'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import { CaseIdSchema, CaseSearchParamsSchema } from '../../../shared/types/ipc-schemas'
import { mainLogger } from '../../services/MainLogger'
import type { DeleteWorkerRequest, DeleteWorkerResponse } from '../../workers/delete-worker'

// Schema for batch delete IDs array
const CaseIdArraySchema = z.array(z.number().int().positive()).min(1)

function safeEmit(channel: string, data: unknown): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (win === undefined || win.isDestroyed()) return
  win.webContents.send(channel, data)
}

/**
 * Run a delete operation in a worker thread to avoid blocking the main process.
 */
function runDeleteWorker(request: DeleteWorkerRequest): Promise<number> {
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
 * Cases IPC handlers
 * Channels: cases:list, cases:delete, cases:deleteAll, cases:deleteBatch
 */
export function registerCaseHandlers({ ipcMain, getDb, getDbPool }: HandlerDependencies): void {
  ipcMain.handle('cases:list', async () => {
    return wrapHandler(async () => {
      const pool = getDbPool?.()
      if (pool) {
        return await pool.run({ type: 'cases:list', params: [] })
      }

      const db = getDb()
      return db.cases.getAllCases()
    })
  })

  ipcMain.handle('cases:query', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      const validated = CaseSearchParamsSchema.safeParse(params)
      if (validated.success !== true) {
        mainLogger.error(`Invalid cases:query params: ${validated.error.message}`, 'cases')
        throw new Error('Invalid parameters')
      }

      const pool = getDbPool?.()
      if (pool) {
        return await pool.run({ type: 'cases:query', params: [validated.data] })
      }

      const db = getDb()
      return db.cases.queryCases(validated.data)
    })
  })

  ipcMain.handle('cases:delete', async (_event, id: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = CaseIdSchema.safeParse(id)
      if (!validated.success) {
        mainLogger.error(`Invalid cases:delete params: ${validated.error.message}`, 'cases')
        throw new Error('Invalid parameters')
      }

      const db = getDb()

      let incrementalSucceeded = false
      try {
        // Incremental remove BEFORE cascade delete (reads from variants)
        db.cohortSummary.incrementalRemove(validated.data)
        incrementalSucceeded = true
      } catch {
        // Fallback: mark stale — next full rebuild will correct
        db.cohortSummary.markStale()
        safeEmit('cohort:summaryRebuilt', { is_stale: true })
      }

      db.cases.deleteCase(validated.data)

      if (incrementalSucceeded) {
        // Variant summary updated but gene_burden still stale
        safeEmit('cohort:summaryRebuilt', { is_stale: true })
      }

      return undefined
    })
  })

  ipcMain.handle('cases:deleteAll', async () => {
    return wrapHandler(async () => {
      const db = getDb()
      mainLogger.info(`Starting deleteAll worker (db: ${db.getPath()})`, 'cases')
      safeEmit('cohort:summaryRebuilt', { is_stale: true })
      try {
        const deleted = await runDeleteWorker({
          type: 'deleteAll',
          dbPath: db.getPath(),
          encryptionKey: db.getEncryptionKey()
        })
        mainLogger.info(`deleteAll completed: ${deleted} cases deleted`, 'cases')
        safeEmit('cases:deleted', { deleted })
        safeEmit('cohort:summaryRebuilt', { is_stale: false })
        return deleted
      } catch (error) {
        mainLogger.error(
          `deleteAll worker failed: ${error instanceof Error ? error.message : error}`,
          'cases'
        )
        throw error
      }
    })
  })

  ipcMain.handle('cases:deleteBatch', async (_event, ids: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = CaseIdArraySchema.safeParse(ids)
      if (!validated.success) {
        mainLogger.error(`Invalid cases:deleteBatch params: ${validated.error.message}`, 'cases')
        throw new Error('Invalid parameters')
      }

      const db = getDb()
      safeEmit('cohort:summaryRebuilt', { is_stale: true })
      const deleted = await runDeleteWorker({
        type: 'deleteBatch',
        dbPath: db.getPath(),
        encryptionKey: db.getEncryptionKey(),
        ids: validated.data
      })
      safeEmit('cases:deleted', { deleted })
      safeEmit('cohort:summaryRebuilt', { is_stale: false })
      return deleted
    })
  })
}
