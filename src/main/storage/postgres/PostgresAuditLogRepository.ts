import type { Pool } from 'pg'

import type {
  AuditLogEntry,
  AuditActionType,
  AuditEntityType
} from '../../../shared/types/database'
import type { AuditAppendParams, AuditQueryParams, AuditQueryResult } from '../audit-log-types'
import {
  serializeAuditContractMetadata,
  serializeAuditContractValue
} from '../../../shared/audit/audit-contract'
import { toNumber } from './identifiers'

/**
 * The audit trail lives in the shared `varlens_audit` schema (migration
 * 0013), not in the per-project schema: rows survive project deletion and
 * the table is append-only (trigger-enforced; ownership-separated after
 * scripts/postgres/provision-audit-owner.sh). The constructor's `schema`
 * is the project discriminator stamped into `project_schema` on every
 * write and filtered on every read.
 */
const AUDIT_TABLE = 'varlens_audit."audit_log"'

type AuditRow = Record<string, unknown>

function toNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

function toAuditLogEntry(row: AuditRow): AuditLogEntry {
  return {
    id: toNumber(row.id),
    timestamp: toNumber(row.created_at ?? row.timestamp),
    action_type: String(row.action_type ?? '') as AuditActionType,
    entity_type: String(row.entity_type ?? '') as AuditEntityType,
    entity_key: String(row.entity_key ?? ''),
    old_value: toNullableString(row.old_value),
    new_value: toNullableString(row.new_value),
    user_name: toNullableString(row.user_name)
  }
}

export class PostgresAuditLogRepository {
  constructor(
    private readonly pool: Pick<Pool, 'query'>,
    private readonly projectSchema: string
  ) {}

  async getByEntityKey(entityKey: string): Promise<AuditLogEntry[]> {
    const result = await this.pool.query<AuditRow>(
      `SELECT * FROM ${AUDIT_TABLE}
       WHERE project_schema = $1 AND entity_key = $2
       ORDER BY created_at ASC`,
      [this.projectSchema, entityKey]
    )
    return result.rows.map(toAuditLogEntry)
  }

  async query(params: AuditQueryParams): Promise<AuditQueryResult> {
    const { whereSql, values } = this.buildWhere(params)

    const countResult = await this.pool.query<{ total_count: unknown }>(
      `SELECT COUNT(*)::bigint AS total_count
       FROM ${AUDIT_TABLE}
       ${whereSql}`,
      values
    )

    const limit = params.limit ?? 100
    const offset = params.offset ?? 0
    const dataParams = [...values, limit, offset]
    const result = await this.pool.query<AuditRow>(
      `SELECT *
       FROM ${AUDIT_TABLE}
       ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    )

    return {
      data: result.rows.map(toAuditLogEntry),
      total_count: toNumber(countResult.rows[0]?.total_count)
    }
  }

  async append(params: AuditAppendParams): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${AUDIT_TABLE} (
        project_schema, action_type, entity_type, entity_key, old_value, new_value, user_name, metadata_json
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        this.projectSchema,
        params.action_type,
        params.entity_type,
        params.entity_key,
        serializeAuditContractValue(params.old_value),
        serializeAuditContractValue(params.new_value),
        params.user_name ?? null,
        serializeAuditContractMetadata(params.metadata)
      ]
    )
  }

  /**
   * Multi-row append used by the web audit buffer. One INSERT per batch
   * instead of one round-trip per row. `occurred_at` (epoch ms) preserves the
   * time the audited request happened rather than the flush time; rows
   * without it fall back to the column default clock.
   */
  async appendMany(
    rows: ReadonlyArray<AuditAppendParams & { occurred_at?: number }>
  ): Promise<void> {
    if (rows.length === 0) return
    const values: unknown[] = []
    const tuples = rows.map((row) => {
      const base = values.length
      values.push(
        this.projectSchema,
        row.action_type,
        row.entity_type,
        row.entity_key,
        serializeAuditContractValue(row.old_value),
        serializeAuditContractValue(row.new_value),
        row.user_name ?? null,
        serializeAuditContractMetadata(row.metadata),
        row.occurred_at ?? null
      )
      const p = (offset: number): string => `$${base + offset}`
      return `(${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)}, ${p(7)}, ${p(8)},
        COALESCE(${p(9)}::bigint, (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint))`
    })
    await this.pool.query(
      `INSERT INTO ${AUDIT_TABLE} (
        project_schema, action_type, entity_type, entity_key, old_value, new_value, user_name,
        metadata_json, created_at
      ) VALUES ${tuples.join(',\n')}`,
      values
    )
  }

  private buildWhere(params: AuditQueryParams): { whereSql: string; values: unknown[] } {
    const where: string[] = []
    const values: unknown[] = []
    const add = (value: unknown): string => {
      values.push(value)
      return `$${values.length}`
    }

    where.push(`project_schema = ${add(this.projectSchema)}`)
    if (params.action_type !== undefined) where.push(`action_type = ${add(params.action_type)}`)
    if (params.entity_type !== undefined) where.push(`entity_type = ${add(params.entity_type)}`)
    if (params.entity_key !== undefined) where.push(`entity_key = ${add(params.entity_key)}`)
    if (params.from_timestamp !== undefined) {
      where.push(`created_at >= ${add(params.from_timestamp)}`)
    }
    if (params.to_timestamp !== undefined) {
      where.push(`created_at <= ${add(params.to_timestamp)}`)
    }

    return {
      whereSql: `WHERE ${where.join(' AND ')}`,
      values
    }
  }
}
