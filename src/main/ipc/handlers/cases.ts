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
    return db.getAllCases()
  })
})

ipcMain.handle('cases:delete', async (_event, id: number) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    db.deleteCase(id)
    return undefined
  })
})

ipcMain.handle('cases:deleteAll', async () => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    return db.deleteAllCases()
  })
})

ipcMain.handle('cases:deleteBatch', async (_event, ids: number[]) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    return db.deleteCasesBatch(ids)
  })
})
