import { z } from 'zod'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import { CaseIdSchema } from '../../../shared/types/ipc-schemas'
import { mainLogger } from '../../services/MainLogger'

// ============================================================
// Inline Zod Schemas for Case Comments
// ============================================================

const CommentIdSchema = z.number().int().positive()

const CommentCategorySchema = z.enum([
  'Clinical Note',
  'Lab Result',
  'Interpretation',
  'Follow-up',
  'Family History',
  'Treatment'
])

const CommentCreateSchema = z.object({
  caseId: CaseIdSchema,
  category: CommentCategorySchema,
  content: z.string().min(1)
})

const CommentUpdateSchema = z.object({
  commentId: CommentIdSchema,
  content: z.string().min(1)
})

/**
 * Case Comments IPC handlers
 *
 * Channels: case-comments:list, case-comments:create,
 *           case-comments:update, case-comments:delete
 */
export function registerCaseCommentHandlers({ ipcMain, getDb }: HandlerDependencies): void {
  ipcMain.handle('case-comments:list', async (_event, caseId: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = CaseIdSchema.safeParse(caseId)
      if (!validated.success) {
        mainLogger.error(
          `Invalid case-comments:list params: ${validated.error.message}`,
          'case-comments'
        )
        throw new Error('Invalid parameters')
      }

      const db = getDb()
      return db.metadata.listCaseComments(validated.data)
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

        const db = getDb()
        return db.metadata.createCaseComment(
          validated.data.caseId,
          validated.data.category,
          validated.data.content
        )
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

      const db = getDb()
      return db.metadata.updateCaseComment(validated.data.commentId, validated.data.content)
    })
  })

  ipcMain.handle('case-comments:delete', async (_event, commentId: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = CommentIdSchema.safeParse(commentId)
      if (!validated.success) {
        mainLogger.error(
          `Invalid case-comments:delete params: ${validated.error.message}`,
          'case-comments'
        )
        throw new Error('Invalid parameters')
      }

      const db = getDb()
      db.metadata.deleteCaseComment(validated.data)
      return undefined
    })
  })
}
