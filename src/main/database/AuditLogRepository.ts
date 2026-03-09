import { BaseRepository } from './BaseRepository'
import { sql } from 'kysely'
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
    const compiled = sql<AuditLogEntry>`
        INSERT INTO audit_log (timestamp, action_type, entity_type, entity_key, old_value, new_value, user_name)
        VALUES (${now}, ${input.action_type}, ${input.entity_type}, ${input.entity_key}, ${input.old_value}, ${input.new_value}, ${input.user_name})
        RETURNING *
      `.compile(this.kysely)
    return this.db.prepare(compiled.sql).get(...compiled.parameters) as AuditLogEntry
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
    let baseQuery = this.kysely.selectFrom('audit_log')

    if (filter.action_type) {
      baseQuery = baseQuery.where('action_type', '=', filter.action_type)
    }
    if (filter.entity_type) {
      baseQuery = baseQuery.where('entity_type', '=', filter.entity_type)
    }
    if (filter.entity_key !== undefined && filter.entity_key !== null) {
      baseQuery = baseQuery.where('entity_key', '=', filter.entity_key)
    }
    if (filter.from_timestamp !== undefined && filter.from_timestamp !== null) {
      baseQuery = baseQuery.where('timestamp', '>=', filter.from_timestamp)
    }
    if (filter.to_timestamp !== undefined && filter.to_timestamp !== null) {
      baseQuery = baseQuery.where('timestamp', '<=', filter.to_timestamp)
    }

    const countResult = this.execFirst<{ count: number }>(
      baseQuery.select(({ fn }) => fn.countAll<number>().as('count'))
    )
    const total_count = countResult?.count ?? 0

    const limit = filter.limit ?? 100
    const offset = filter.offset ?? 0

    const data = this.execAll<AuditLogEntry>(
      baseQuery.selectAll().orderBy('timestamp', 'desc').limit(limit).offset(offset)
    )

    return { data, total_count }
  }
}
