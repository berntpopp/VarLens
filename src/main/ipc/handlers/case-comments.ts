import { ipcMain } from 'electron'
import { wrapHandler } from '../errorHandler'
import { getDatabaseService } from '../../database'
import type { CommentCategory } from '../../database/types'

/**
 * Case Comments IPC handlers
 *
 * Channels: case-comments:list, case-comments:create,
 *           case-comments:update, case-comments:delete
 */

ipcMain.handle('case-comments:list', async (_event, caseId: number) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    return db.metadata.listCaseComments(caseId)
  })
})

ipcMain.handle(
  'case-comments:create',
  async (_event, caseId: number, category: CommentCategory, content: string) => {
    return wrapHandler(async () => {
      const db = getDatabaseService()
      return db.metadata.createCaseComment(caseId, category, content)
    })
  }
)

ipcMain.handle('case-comments:update', async (_event, commentId: number, content: string) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    return db.metadata.updateCaseComment(commentId, content)
  })
})

ipcMain.handle('case-comments:delete', async (_event, commentId: number) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    db.metadata.deleteCaseComment(commentId)
    return undefined
  })
})
