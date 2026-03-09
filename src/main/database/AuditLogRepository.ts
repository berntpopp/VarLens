import { BaseRepository } from './BaseRepository'
import type { AuditLogEntry, AuditActionType, AuditEntityType } from './types'

interface AppendEntryInput {
  action_type: AuditActionType
  entity_type: AuditEntityType
  entity_key: string
  old_value: string | null
  new_value: string | null
  user_name: string | null
}

export interface AuditQueryFilter {
  action_type?: AuditActionType
  entity_type?: AuditEntityType
  entity_key?: string
  from_timestamp?: number
  to_timestamp?: number
  limit?: number
  offset?: number
}

export interface AuditQueryResult {
  data: AuditLogEntry[]
  total_count: number
}

export class AuditLogRepository extends BaseRepository {
  appendEntry(input: AppendEntryInput): AuditLogEntry {
    const now = Date.now()
    return this.stmt(
      `INSERT INTO audit_log (timestamp, action_type, entity_type, entity_key, old_value, new_value, user_name)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    ).get(
      now,
      input.action_type,
      input.entity_type,
      input.entity_key,
      input.old_value,
      input.new_value,
      input.user_name
    ) as AuditLogEntry
  }

  getByEntityKey(entityKey: string): AuditLogEntry[] {
    return this.execAll<AuditLogEntry>(
      this.kysely
        .selectFrom('audit_log')
        .selectAll()
        .where('entity_key', '=', entityKey)
        .orderBy('timestamp', 'asc')
    )
  }

  query(filter: AuditQueryFilter): AuditQueryResult {
    const conditions: string[] = []
    const params: unknown[] = []

    if (filter.action_type) {
      conditions.push('action_type = ?')
      params.push(filter.action_type)
    }
    if (filter.entity_type) {
      conditions.push('entity_type = ?')
      params.push(filter.entity_type)
    }
    if (filter.entity_key !== undefined && filter.entity_key !== null) {
      conditions.push('entity_key = ?')
      params.push(filter.entity_key)
    }
    if (filter.from_timestamp !== undefined && filter.from_timestamp !== null) {
      conditions.push('timestamp >= ?')
      params.push(filter.from_timestamp)
    }
    if (filter.to_timestamp !== undefined && filter.to_timestamp !== null) {
      conditions.push('timestamp <= ?')
      params.push(filter.to_timestamp)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const total_count = (
      this.stmt(`SELECT COUNT(*) as count FROM audit_log ${where}`).get(...params) as {
        count: number
      }
    ).count

    const limit = filter.limit ?? 100
    const offset = filter.offset ?? 0

    const data = this.stmt(
      `SELECT * FROM audit_log ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as AuditLogEntry[]

    return { data, total_count }
  }
}
