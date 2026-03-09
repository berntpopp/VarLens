import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import type { AuditActionType, AuditEntityType } from '../../database/types'

interface AuditQueryParams {
  action_type?: AuditActionType
  entity_type?: AuditEntityType
  entity_key?: string
  from_timestamp?: number
  to_timestamp?: number
  limit?: number
  offset?: number
}

/**
 * Audit Log IPC handlers
 * Channels: audit:getByEntity, audit:query
 */
export function registerAuditLogHandlers({ ipcMain, getDb }: HandlerDependencies): void {
  /**
   * Get audit log entries for a specific entity
   */
  ipcMain.handle('audit:getByEntity', async (_event, entityKey: string) => {
    return wrapHandler(async () => {
      const db = getDb()
      return db.auditLog.getByEntityKey(entityKey)
    })
  })

  /**
   * Query audit log with filters
   */
  ipcMain.handle('audit:query', async (_event, params: AuditQueryParams) => {
    return wrapHandler(async () => {
      const db = getDb()
      return db.auditLog.query(params)
    })
  })
}
