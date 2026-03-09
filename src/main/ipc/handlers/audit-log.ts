import { ipcMain } from 'electron'
import { wrapHandler } from '../errorHandler'
import { getDatabaseService } from '../../database'
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
 * Get audit log entries for a specific entity
 */
ipcMain.handle('audit:getByEntity', async (_event, entityKey: string) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    return db.auditLog.getByEntityKey(entityKey)
  })
})

/**
 * Query audit log with filters
 */
ipcMain.handle('audit:query', async (_event, params: AuditQueryParams) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    return db.auditLog.query(params)
  })
})
