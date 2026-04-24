import { z } from 'zod'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import { CaseIdSchema, CaseSearchParamsSchema } from '../../../shared/types/ipc-schemas'
import { mainLogger } from '../../services/MainLogger'
import { safeEmit } from '../utils/safeEmit'
import {
  listCases,
  queryCases,
  deleteSingleCase,
  deleteAllCases,
  deleteBatchCases,
  getAvailableBuilds
} from './cases-logic'
import type { DeleteCallbacks } from './cases-logic'

// Schema for batch delete IDs array
const CaseIdArraySchema = z.array(z.number().int().positive()).min(1)

/** Shared callbacks that wire logic-layer events to renderer via safeEmit. */
const deleteCallbacks: DeleteCallbacks = {
  onDeleted: (data) => safeEmit('cases:deleted', data),
  onCohortStale: (data) => safeEmit('cohort:summaryRebuilt', data)
}

function assertFileBackedWorkerWritesSupported(
  operation: 'cases:delete' | 'cases:deleteAll' | 'cases:deleteBatch',
  getDbManager: HandlerDependencies['getDbManager']
): void {
  const session = getDbManager().getCurrentSession()
  if (!session.capabilities.supportsFileBackedWorkerWrites) {
    throw new Error(`${operation} is SQLite-only in Phase 4`)
  }
}

/**
 * Cases IPC handlers
 * Channels: cases:list, cases:query, cases:delete, cases:deleteAll, cases:deleteBatch
 */
export function registerCaseHandlers({ ipcMain, getDb, getDbManager }: HandlerDependencies): void {
  ipcMain.handle('cases:list', async () => {
    return wrapHandler(() => listCases(() => getDbManager().getCurrentSession()))
  })

  ipcMain.handle('cases:availableBuilds', async () => {
    return wrapHandler(() => getAvailableBuilds(() => getDbManager().getCurrentSession()))
  })

  ipcMain.handle('cases:query', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      const validated = CaseSearchParamsSchema.safeParse(params)
      if (validated.success !== true) {
        mainLogger.error(`Invalid cases:query params: ${validated.error.message}`, 'cases')
        throw new Error('Invalid parameters')
      }
      return queryCases(validated.data, () => getDbManager().getCurrentSession())
    })
  })

  ipcMain.handle('cases:delete', async (_event, id: unknown) => {
    return wrapHandler(async () => {
      const validated = CaseIdSchema.safeParse(id)
      if (!validated.success) {
        mainLogger.error(`Invalid cases:delete params: ${validated.error.message}`, 'cases')
        throw new Error('Invalid parameters')
      }
      assertFileBackedWorkerWritesSupported('cases:delete', getDbManager)
      await deleteSingleCase(validated.data, getDb, deleteCallbacks)
      return undefined
    })
  })

  ipcMain.handle('cases:deleteAll', async () => {
    return wrapHandler(() => {
      assertFileBackedWorkerWritesSupported('cases:deleteAll', getDbManager)
      return deleteAllCases(getDb, deleteCallbacks)
    })
  })

  ipcMain.handle('cases:deleteBatch', async (_event, ids: unknown) => {
    return wrapHandler(async () => {
      const validated = CaseIdArraySchema.safeParse(ids)
      if (!validated.success) {
        mainLogger.error(`Invalid cases:deleteBatch params: ${validated.error.message}`, 'cases')
        throw new Error('Invalid parameters')
      }
      assertFileBackedWorkerWritesSupported('cases:deleteBatch', getDbManager)
      return deleteBatchCases(validated.data, getDb, deleteCallbacks)
    })
  })
}
