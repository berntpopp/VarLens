import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'

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

  ipcMain.handle('cases:delete', async (_event, id: number) => {
    return wrapHandler(async () => {
      const db = getDb()
      db.cases.deleteCase(id)
      return undefined
    })
  })

  ipcMain.handle('cases:deleteAll', async () => {
    return wrapHandler(async () => {
      const db = getDb()
      return db.cases.deleteAllCases()
    })
  })

  ipcMain.handle('cases:deleteBatch', async (_event, ids: number[]) => {
    return wrapHandler(async () => {
      const db = getDb()
      return db.cases.deleteCasesBatch(ids)
    })
  })
}
