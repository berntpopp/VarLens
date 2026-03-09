import { z } from 'zod'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import { CaseIdSchema } from '../../../shared/types/ipc-schemas'
import { mainLogger } from '../../services/MainLogger'

// Schema for batch delete IDs array
const CaseIdArraySchema = z.array(z.number().int().positive()).min(1)

/**
 * Cases IPC handlers
 * Channels: cases:list, cases:delete, cases:deleteAll, cases:deleteBatch
 */
export function registerCaseHandlers({ ipcMain, getDb }: HandlerDependencies): void {
  ipcMain.handle('cases:list', async () => {
    return wrapHandler(async () => {
      const db = getDb()
      return db.cases.getAllCases()
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
      db.cases.deleteCase(validated.data)
      return undefined
    })
  })

  ipcMain.handle('cases:deleteAll', async () => {
    return wrapHandler(async () => {
      const db = getDb()
      return db.cases.deleteAllCases()
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
      return db.cases.deleteCasesBatch(validated.data)
    })
  })
}
