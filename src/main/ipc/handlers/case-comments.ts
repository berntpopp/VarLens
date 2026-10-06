import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import {
  CaseCommentCaseIdSchema,
  CaseCommentIdSchema,
  CommentCreateSchema,
  CommentUpdateSchema
} from '../../../shared/api/schemas/case-comments'
import { mainLogger } from '../../services/MainLogger'

/**
 * Case Comments IPC handlers
 *
 * Channels: case-comments:list, case-comments:create,
 *           case-comments:update, case-comments:delete
 */
export function registerCaseCommentHandlers({
  ipcMain,
  getDb,
  getDbManager
}: HandlerDependencies): void {
  ipcMain.handle('case-comments:list', async (_event, caseId: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = CaseCommentCaseIdSchema.safeParse(caseId)
      if (!validated.success) {
        mainLogger.error(
          `Invalid case-comments:list params: ${validated.error.message}`,
          'case-comments'
        )
        throw new Error('Invalid parameters')
      }

      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        return await session
          .getReadExecutor()
          .execute({ type: 'case-comments:list', params: [validated.data] })
      }
      return getDb().metadata.listCaseComments(validated.data)
    })
  })

  ipcMain.handle(
    'case-comments:create',
    async (_event, caseId: unknown, category: unknown, content: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validated = CommentCreateSchema.safeParse({ caseId, category, content })
        if (!validated.success) {
          mainLogger.error(
            `Invalid case-comments:create params: ${validated.error.message}`,
            'case-comments'
          )
          throw new Error('Invalid parameters')
        }

        const session = getDbManager().getCurrentSession()
        return await session.getWriteExecutor().execute({
          type: 'case-comments:create',
          params: [validated.data.caseId, validated.data.category, validated.data.content]
        })
      })
    }
  )

  ipcMain.handle('case-comments:update', async (_event, commentId: unknown, content: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = CommentUpdateSchema.safeParse({ commentId, content })
      if (!validated.success) {
        mainLogger.error(
          `Invalid case-comments:update params: ${validated.error.message}`,
          'case-comments'
        )
        throw new Error('Invalid parameters')
      }

      const session = getDbManager().getCurrentSession()
      return await session.getWriteExecutor().execute({
        type: 'case-comments:update',
        params: [validated.data.commentId, validated.data.content]
      })
    })
  })

  ipcMain.handle('case-comments:delete', async (_event, commentId: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = CaseCommentIdSchema.safeParse(commentId)
      if (!validated.success) {
        mainLogger.error(
          `Invalid case-comments:delete params: ${validated.error.message}`,
          'case-comments'
        )
        throw new Error('Invalid parameters')
      }

      const session = getDbManager().getCurrentSession()
      await session
        .getWriteExecutor()
        .execute({ type: 'case-comments:delete', params: [validated.data] })
      return undefined
    })
  })
}
