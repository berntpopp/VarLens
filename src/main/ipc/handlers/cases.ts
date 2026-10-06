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
  getAvailableBuilds,
  acquireDeleteLock,
  releaseDeleteLock,
  startSqliteCaseDeleteJob
} from './cases-logic'
import type { DeleteCallbacks } from './cases-logic'

// Schema for batch delete IDs array
const CaseIdArraySchema = z.array(z.number().int().positive()).min(1)

const CaseDeleteTargetSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('ids'), ids: CaseIdArraySchema.max(10_000) }).strict(),
  z.object({ mode: z.literal('all') }).strict()
])

/** Shared callbacks that wire logic-layer events to renderer via safeEmit. */
const deleteCallbacks: DeleteCallbacks = {
  onDeleted: (data) => safeEmit('cases:deleted', data),
  onCohortStale: (data) => safeEmit('cohort:summaryRebuilt', data)
}

function assertCaseDeleteSupported(
  operation: 'cases:delete' | 'cases:deleteAll' | 'cases:deleteBatch',
  getDbManager: HandlerDependencies['getDbManager']
): void {
  const session = getDbManager().getCurrentSession()
  const supported =
    operation === 'cases:delete'
      ? session.capabilities.cases.deleteOne
      : operation === 'cases:deleteBatch'
        ? session.capabilities.cases.deleteMany
        : session.capabilities.cases.deleteAll

  if (!supported) {
    throw new Error(`${operation} is SQLite-only in Phase 4`)
  }
}

async function deleteSingleCaseForCurrentSession(
  id: number,
  getDb: HandlerDependencies['getDb'],
  getDbManager: HandlerDependencies['getDbManager']
): Promise<void> {
  const session = getDbManager().getCurrentSession()
  if (session.capabilities.backend === 'postgres') {
    if (!acquireDeleteLock()) {
      mainLogger.warn(
        `Delete already in progress, rejecting postgres delete for case ${id}`,
        'cases'
      )
      throw new Error('A delete operation is already in progress. Please wait for it to finish.')
    }

    try {
      await session.getWriteExecutor().execute({ type: 'cases:delete', params: [id] })
      deleteCallbacks.onDeleted?.({ deleted: 1 })
    } finally {
      releaseDeleteLock()
    }
    return
  }

  await deleteSingleCase(id, getDb, deleteCallbacks)
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
      assertCaseDeleteSupported('cases:delete', getDbManager)
      await deleteSingleCaseForCurrentSession(validated.data, getDb, getDbManager)
      return undefined
    })
  })

  ipcMain.handle('cases:deleteAll', async () => {
    return wrapHandler(() => {
      assertCaseDeleteSupported('cases:deleteAll', getDbManager)
      return deleteAllCases(getDb, deleteCallbacks)
    })
  })

  ipcMain.handle('cases:startDelete', async (_event, target: unknown) => {
    return wrapHandler(async () => {
      const validated = CaseDeleteTargetSchema.safeParse(target)
      if (!validated.success) {
        mainLogger.error(`Invalid cases:startDelete params: ${validated.error.message}`, 'cases')
        throw new Error('Invalid parameters')
      }
      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend !== 'sqlite') {
        // The web/Postgres delete job is served by the web dispatcher.
        throw new Error('cases:startDelete is only available for SQLite databases on desktop')
      }
      assertCaseDeleteSupported(
        validated.data.mode === 'all' ? 'cases:deleteAll' : 'cases:deleteBatch',
        getDbManager
      )
      const handle = startSqliteCaseDeleteJob(validated.data, getDb, deleteCallbacks)
      // Fire-and-forget: the outcome is reported via `jobs:changed`.
      handle.result.catch(() => undefined)
      return { jobId: handle.id }
    })
  })

  ipcMain.handle('cases:deleteBatch', async (_event, ids: unknown) => {
    return wrapHandler(async () => {
      const validated = CaseIdArraySchema.safeParse(ids)
      if (!validated.success) {
        mainLogger.error(`Invalid cases:deleteBatch params: ${validated.error.message}`, 'cases')
        throw new Error('Invalid parameters')
      }
      assertCaseDeleteSupported('cases:deleteBatch', getDbManager)
      return deleteBatchCases(validated.data, getDb, deleteCallbacks)
    })
  })
}
