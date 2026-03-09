import { ipcMain } from 'electron'
import { wrapHandler } from '../errorHandler'
import { getDatabaseService } from '../../database'

/**
 * Cases IPC handlers
 * Channels: cases:list, cases:delete
 */

ipcMain.handle('cases:list', async () => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    return db.cases.getAllCases()
  })
})

ipcMain.handle('cases:delete', async (_event, id: number) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    db.cases.deleteCase(id)
    return undefined
  })
})

ipcMain.handle('cases:deleteAll', async () => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    return db.cases.deleteAllCases()
  })
})

ipcMain.handle('cases:deleteBatch', async (_event, ids: number[]) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    return db.cases.deleteCasesBatch(ids)
  })
})
