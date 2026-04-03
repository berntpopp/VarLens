import { z } from 'zod'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import {
  CohortSearchParamsSchema,
  AssociationConfigSchema
} from '../../../shared/types/ipc-schemas'
import { mainLogger } from '../../services/MainLogger'
import { safeEmit } from '../utils/safeEmit'
import type { DatabaseService } from '../../database/DatabaseService'
import {
  queryCohortVariants,
  getColumnMeta,
  getCohortSummary,
  getCarriers,
  getGeneBurden,
  runGeneBurdenCompare,
  cancelGeneBurdenCompare,
  getSummaryStatus,
  rebuildSummary,
  triggerStartupRebuildIfNeeded as triggerStartupRebuildIfNeededLogic
} from './cohort-logic'
import type { CohortCallbacks } from './cohort-logic'

// Schema for carriers query params
const CarriersParamsSchema = z.object({
  chr: z.string().min(1),
  pos: z.number().int().positive(),
  ref: z.string().min(1),
  alt: z.string().min(1)
})

/** Shared callbacks that wire logic-layer events to renderer via safeEmit. */
const cohortCallbacks: CohortCallbacks = {
  onSummaryStale: (data) => safeEmit('cohort:summaryRebuilt', data),
  onSummaryFresh: (data) => safeEmit('cohort:summaryRebuilt', data)
}

/**
 * Cohort IPC handlers
 * Channels: cohort:variants, cohort:summary, cohort:carriers,
 *           cohort:geneBurden, cohort:geneBurdenCompare, cohort:geneBurdenCancel
 */
export function registerCohortHandlers({ ipcMain, getDb, getDbPool }: HandlerDependencies): void {
  ipcMain.handle('cohort:variants', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = CohortSearchParamsSchema.safeParse(params)
      if (!validated.success) {
        mainLogger.error(`Invalid cohort:variants params: ${validated.error.message}`, 'cohort')
        throw new Error('Invalid search parameters')
      }

      return queryCohortVariants(validated.data, getDb, getDbPool)
    })
  })

  ipcMain.handle('cohort:columnMeta', async (_event) => {
    return wrapHandler(async () => {
      return getColumnMeta(getDb, getDbPool)
    })
  })

  ipcMain.handle('cohort:summary', async (_event) => {
    return wrapHandler(async () => {
      return getCohortSummary(getDb, getDbPool)
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

        return getCarriers(
          validated.data.chr,
          validated.data.pos,
          validated.data.ref,
          validated.data.alt,
          getDb,
          getDbPool
        )
      })
    }
  )

  ipcMain.handle('cohort:geneBurden', async (_event) => {
    return wrapHandler(async () => {
      return getGeneBurden(getDb, getDbPool)
    })
  })

  ipcMain.handle('cohort:geneBurdenCompare', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      const validated = AssociationConfigSchema.safeParse(params)
      if (!validated.success) {
        mainLogger.error(`Invalid association config: ${validated.error.message}`, 'cohort')
        throw new Error('Invalid association analysis parameters')
      }

      return runGeneBurdenCompare(validated.data, getDb, getDbPool, (data) =>
        safeEmit('cohort:geneBurdenProgress', data)
      )
    })
  })

  ipcMain.handle('cohort:geneBurdenCancel', async () => {
    cancelGeneBurdenCompare()
  })

  // Summary status
  ipcMain.handle('cohort:summaryStatus', async () => {
    return wrapHandler(async () => {
      return getSummaryStatus(getDb, getDbPool)
    })
  })

  // Manual rebuild trigger
  ipcMain.handle('cohort:rebuildSummary', async () => {
    return wrapHandler(async () => {
      return rebuildSummary(getDb, cohortCallbacks)
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
  triggerStartupRebuildIfNeededLogic(db, cohortCallbacks)
}
