import { describe, expect, it, vi } from 'vitest'

import { PostgresAuditLogRepository } from '../../../src/main/storage/postgres/PostgresAuditLogRepository'

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

describe('PostgresAuditLogRepository', () => {
  it('queries the central varlens_audit table by entity key scoped to the project schema', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: '1',
            project_schema: 'public',
            action_type: 'star',
            entity_type: 'variant_annotation',
            entity_key: 'v:1',
            old_value: null,
            new_value: '{}',
            metadata_json: null,
            created_at: '1234'
          }
        ]
      })
    }
    const repo = new PostgresAuditLogRepository(pool as never, 'public')

    const result = await repo.getByEntityKey('v:1')

    expect(result).toEqual([
      {
        id: 1,
        action_type: 'star',
        entity_type: 'variant_annotation',
        entity_key: 'v:1',
        old_value: null,
        new_value: '{}',
        user_name: null,
        timestamp: 1234
      }
    ])
    const sql = normalizeSql(pool.query.mock.calls[0][0] as string)
    expect(sql).toContain('FROM varlens_audit."audit_log"')
    expect(sql).toContain('project_schema = $1 AND entity_key = $2')
    expect(sql).toContain('ORDER BY created_at ASC')
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), ['public', 'v:1'])
  })

  it('queries with parameterized filters scoped to the project schema and returns a total count', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ total_count: '2' }] })
        .mockResolvedValueOnce({ rows: [] })
    }
    const repo = new PostgresAuditLogRepository(pool as never, 'tenant"schema')

    const result = await repo.query({
      action_type: 'star',
      entity_type: 'case_variant_annotation',
      entity_key: `case:1' OR TRUE --`,
      from_timestamp: 100,
      to_timestamp: 200,
      limit: 25,
      offset: 50
    })

    const countSql = normalizeSql(pool.query.mock.calls[0][0] as string)
    const dataSql = normalizeSql(pool.query.mock.calls[1][0] as string)
    const params = pool.query.mock.calls[1][1] as unknown[]

    expect(result).toEqual({ data: [], total_count: 2 })
    expect(countSql).toContain('FROM varlens_audit."audit_log"')
    expect(countSql).toContain('project_schema = $1')
    // Entries of one millisecond need a unique tiebreaker to page stably (#503).
    expect(dataSql).toContain('ORDER BY created_at DESC, id DESC')
    expect(dataSql).not.toContain('OR TRUE')
    expect(dataSql).not.toContain('tenant')
    expect(params).toEqual([
      'tenant"schema',
      'star',
      'case_variant_annotation',
      `case:1' OR TRUE --`,
      100,
      200,
      25,
      50
    ])
  })

  it('appends contract-encoded old and new values stamped with the project schema', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const repo = new PostgresAuditLogRepository(pool as never, 'project_two')

    await repo.append({
      action_type: 'star',
      entity_type: 'case_variant_annotation',
      entity_key: 'case:1:variant:2',
      old_value: { starred: 0 },
      new_value: { starred: 1 },
      user_name: 'analyst',
      metadata: { source: 'test' }
    })

    const sql = normalizeSql(pool.query.mock.calls[0][0] as string)
    const params = pool.query.mock.calls[0][1] as unknown[]
    expect(sql).toContain('INSERT INTO varlens_audit."audit_log"')
    expect(sql).toContain('project_schema')
    expect(params[0]).toBe('project_two')
    expect(params).toContain(JSON.stringify({ starred: 0 }))
    expect(params).toContain(JSON.stringify({ starred: 1 }))
    expect(params).toContain('analyst')
    expect(params).toContain(JSON.stringify({ source: 'test' }))
  })

  it('appends sanitized api read events', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const repo = new PostgresAuditLogRepository(pool as never, 'public')

    await repo.append({
      action_type: 'api_read',
      entity_type: 'api_call',
      entity_key: 'cases:query',
      new_value: {
        success: true,
        method: 'cases:query',
        payload: { patient_name: 'hidden' }
      },
      user_name: 'analyst',
      metadata: { source: 'web-dispatcher' }
    })

    const params = pool.query.mock.calls[0][1] as unknown[]
    expect(params).toContain('api_read')
    expect(params).toContain('api_call')
    expect(params).toContain(JSON.stringify({ success: true, method: 'cases:query' }))
    expect(JSON.stringify(params)).not.toContain('patient_name')
  })

  it('sanitizes pre-serialized audit values and SQL nulls', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const repo = new PostgresAuditLogRepository(pool as never, 'public')
    const serializedNewValue = JSON.stringify({ starred: 1 })

    await repo.append({
      action_type: 'star',
      entity_type: 'variant_annotation',
      entity_key: '1:100:A:G',
      old_value: null,
      new_value: serializedNewValue
    })

    const params = pool.query.mock.calls[0][1] as unknown[]
    expect(params).toEqual([
      'public',
      'star',
      'variant_annotation',
      '1:100:A:G',
      null,
      serializedNewValue,
      null,
      null
    ])
  })

  it('redacts unsafe audit values and metadata before writing', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const repo = new PostgresAuditLogRepository(pool as never, 'public')

    await repo.append({
      action_type: 'comment_add',
      entity_type: 'case_variant_annotation',
      entity_key: 'case:1:variant:2',
      old_value: null,
      new_value: { comment: 'patient detail', payload: { patient_id: 'p-123' } },
      metadata: { patient_id: 'p-123' }
    })

    const params = pool.query.mock.calls[0][1] as unknown[]
    expect(params).toEqual([
      'public',
      'comment_add',
      'case_variant_annotation',
      'case:1:variant:2',
      null,
      JSON.stringify({ redacted: true }),
      null,
      JSON.stringify({ redacted: true, kind: 'metadata' })
    ])
  })

  it('appendMany writes one multi-row INSERT with sanitized values and occurred_at', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const repo = new PostgresAuditLogRepository(pool as never, 'public')

    await repo.appendMany([
      {
        action_type: 'api_read',
        entity_type: 'api_call',
        entity_key: 'tags:list',
        new_value: { success: true, method: 'tags:list', payload: { patient_id: 'p' } },
        user_name: 'alice',
        occurred_at: 1700000000000
      },
      { action_type: 'api_read', entity_type: 'api_call', entity_key: 'cases:list' }
    ])

    expect(pool.query).toHaveBeenCalledTimes(1)
    const sql = normalizeSql(pool.query.mock.calls[0][0] as string)
    expect(sql).toContain('INSERT INTO varlens_audit."audit_log"')
    expect(sql).toContain('COALESCE($9::bigint')
    expect(sql).toContain('COALESCE($18::bigint')
    const params = pool.query.mock.calls[0][1] as unknown[]
    expect(params).toHaveLength(18)
    expect(params.slice(0, 4)).toEqual(['public', 'api_read', 'api_call', 'tags:list'])
    expect(String(params[5])).not.toContain('patient_id')
    expect(params[8]).toBe(1700000000000)
    expect(params[17]).toBeNull()
  })

  it('appendMany is a no-op for an empty batch', async () => {
    const pool = { query: vi.fn() }
    const repo = new PostgresAuditLogRepository(pool as never, 'public')
    await repo.appendMany([])
    expect(pool.query).not.toHaveBeenCalled()
  })
})
