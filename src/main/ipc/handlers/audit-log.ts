import { z } from 'zod'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import type { AuditActionType, AuditEntityType } from '../../database/types'
import { mainLogger } from '../../services/MainLogger'

interface AuditQueryParams {
  action_type?: AuditActionType
  entity_type?: AuditEntityType
  entity_key?: string
  from_timestamp?: number
  to_timestamp?: number
  limit?: number
  offset?: number
}

// Schema for entity key validation
const EntityKeySchema = z.string().min(1)

// Schema for audit query parameters
const AuditQueryParamsSchema = z.object({
  action_type: z
    .enum([
      'acmg_classify',
      'acmg_evidence_update',
      'star',
      'unstar',
      'comment_add',
      'comment_edit',
      'comment_delete',
      'tag_assign',
      'tag_remove'
    ])
    .optional(),
  entity_type: z.enum(['variant_annotation', 'case_variant_annotation']).optional(),
  entity_key: z.string().min(1).optional(),
  from_timestamp: z.number().int().nonnegative().optional(),
  to_timestamp: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().max(10000).optional(),
  offset: z.number().int().nonnegative().optional()
})

/**
 * Audit Log IPC handlers
 * Channels: audit:getByEntity, audit:query
 */
export function registerAuditLogHandlers({ ipcMain, getDb }: HandlerDependencies): void {
  /**
   * Get audit log entries for a specific entity
   */
  ipcMain.handle('audit:getByEntity', async (_event, entityKey: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = EntityKeySchema.safeParse(entityKey)
      if (!validated.success) {
        mainLogger.error(
          `Invalid audit:getByEntity params: ${validated.error.message}`,
          'audit-log'
        )
        throw new Error('Invalid parameters')
      }

      const db = getDb()
      return db.auditLog.getByEntityKey(validated.data)
    })
  })

  /**
   * Query audit log with filters
   */
  ipcMain.handle('audit:query', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = AuditQueryParamsSchema.safeParse(params)
      if (!validated.success) {
        mainLogger.error(`Invalid audit:query params: ${validated.error.message}`, 'audit-log')
        throw new Error('Invalid parameters')
      }

      const db = getDb()
      return db.auditLog.query(validated.data as AuditQueryParams)
    })
  })
}
