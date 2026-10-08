import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import {
  CohortSearchParamsSchema,
  AssociationConfigSchema
} from '../../../shared/types/ipc-schemas'
import { CohortCarriersParamsSchema } from '../../../shared/api/schemas/cohort'
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
  rebuildSummary
} from './cohort-logic'
import { recoverInterruptedImportsAtStartup } from './import-interrupted-recovery'
import type { CohortCallbacks } from './cohort-logic'

/** Shared callbacks that wire logic-layer events to renderer via safeEmit. */
const cohortCallbacks: CohortCallbacks = {
  onSummaryStale: (data) => safeEmit('cohort:summaryRebuilt', data),
  onSummaryFresh: (data) => safeEmit('cohort:summaryRebuilt', data),
  // Phase-progress events are multiplexed onto the same channel as the
  // stale/fresh events. The renderer distinguishes them by the presence of
  // a `phase` field. We always set `is_stale: true` on progress payloads so
  // legacy consumers that only read `is_stale` still behave correctly.
  onSummaryProgress: (data) =>
    safeEmit('cohort:summaryRebuilt', {
      is_stale: true,
      phase: data.phase,
      phase_index: data.phase_index,
      phase_total: data.phase_total,
      label: data.label
    })
}

/**
 * Cohort IPC handlers
 * Channels: cohort:variants, cohort:summary, cohort:carriers,
 *           cohort:geneBurden, cohort:geneBurdenCompare, cohort:geneBurdenCancel
 */
export function registerCohortHandlers({
  ipcMain,
  getDb,
  getDbPool,
  getDbManager
}: HandlerDependencies): void {
  const getSession =
    getDbManager === undefined ? undefined : () => getDbManager().getCurrentSession()

  ipcMain.handle('cohort:variants', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = CohortSearchParamsSchema.safeParse(params)
      if (!validated.success) {
        mainLogger.error(`Invalid cohort:variants params: ${validated.error.message}`, 'cohort')
        throw new Error('Invalid search parameters')
      }

      return queryCohortVariants(validated.data, getDb, getDbPool, getSession)
    })
  })

  ipcMain.handle('cohort:columnMeta', async (_event) => {
    return wrapHandler(async () => {
      return getColumnMeta(getDb, getDbPool, getSession)
    })
  })

  ipcMain.handle('cohort:summary', async (_event) => {
    return wrapHandler(async () => {
      return getCohortSummary(getDb, getDbPool, getSession)
    })
  })

  ipcMain.handle('cohort:carriers', async (_event, variant: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = CohortCarriersParamsSchema.safeParse(variant)
      if (!validated.success) {
        mainLogger.error(`Invalid cohort:carriers params: ${validated.error.message}`, 'cohort')
        throw new Error('Invalid carrier query parameters')
      }

      return getCarriers(validated.data, getDb, getDbPool, getSession)
    })
  })

  ipcMain.handle('cohort:geneBurden', async (_event) => {
    return wrapHandler(async () => {
      return getGeneBurden(getDb, getDbPool, getSession)
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
      return getSummaryStatus(getDb, getDbPool, getSession)
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
 * Startup housekeeping for a freshly opened database, off the main thread:
 * discard imports that were interrupted (import-interrupted-recovery.ts), then
 * rebuild the cohort summary in a worker if it is empty over existing
 * variants or was left open by a dead import session.
 *
 * Notifies the renderer via `cohort:summaryRebuilt` before and after
 * the rebuild so the UI can show a progress indicator.
 */
export function triggerStartupRebuildIfNeeded(db: DatabaseService): void {
  void recoverInterruptedImportsAtStartup(db, cohortCallbacks)
}
