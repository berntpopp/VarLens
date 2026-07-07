import { describe, expect, it, vi } from 'vitest'

import {
  classifyPostgresFailureMessage,
  PostgresHealthDiagnostics
} from '../../../src/main/storage/postgres/PostgresHealthDiagnostics'

describe('PostgresHealthDiagnostics', () => {
  it('collects server, schema, role, privilege, and migration status', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('version()')) return { rows: [{ version: 'PostgreSQL 18' }] }
      if (sql.includes('to_regclass')) return { rows: [{ relation: 'public.schema_migrations' }] }
      if (sql.includes('schema_migrations')) return { rows: [{ version: '0005' }] }
      if (sql.includes('USAGE')) return { rows: [{ can_read_schema: true }] }
      if (sql.includes('CREATE')) return { rows: [{ can_write_schema: false }] }
      if (sql.includes('current_user')) return { rows: [{ current_user: 'varlens_app' }] }
      return { rows: [{ ok: 1 }] }
    })
    const diagnostics = new PostgresHealthDiagnostics({ query } as never, 'public')

    await expect(diagnostics.collect()).resolves.toMatchObject({
      ok: true,
      serverVersion: 'PostgreSQL 18',
      currentUser: 'varlens_app',
      schema: 'public',
      currentMigration: '0005',
      canReadSchema: true,
      canWriteSchema: false
    })
  })

  it('treats a missing migration ledger as an unmigrated but reachable database', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('version()')) return { rows: [{ version: 'PostgreSQL 18' }] }
      if (sql.includes('to_regclass')) return { rows: [{ relation: null }] }
      if (sql.includes('USAGE')) return { rows: [{ can_read_schema: true }] }
      if (sql.includes('CREATE')) return { rows: [{ can_write_schema: true }] }
      if (sql.includes('current_user')) return { rows: [{ current_user: 'varlens_app' }] }
      throw new Error(`Unexpected query: ${sql}`)
    })
    const diagnostics = new PostgresHealthDiagnostics({ query } as never, 'public')

    await expect(diagnostics.collect()).resolves.toMatchObject({
      ok: true,
      serverVersion: 'PostgreSQL 18',
      currentUser: 'varlens_app',
      schema: 'public',
      currentMigration: null,
      canReadSchema: true,
      canWriteSchema: true
    })
    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining('"schema_migrations" ORDER BY version DESC LIMIT 1')
    )
  })

  it('probes migration status with quoted schema identifiers via a bound parameter (S7 info fix)', async () => {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('version()')) return { rows: [{ version: 'PostgreSQL 18' }] }
      if (sql.includes('to_regclass')) {
        // Must be a bound $1 parameter, not a hand-escaped string literal —
        // asserting the exact param value also proves it isn't silently
        // dropped or mismatched by the rewrite.
        expect(sql).toContain('to_regclass($1)')
        expect(sql).not.toContain('\'"Workspace-A"')
        expect(params).toEqual([`"Workspace-A"."schema_migrations"`])
        return { rows: [{ relation: '"Workspace-A".schema_migrations' }] }
      }
      if (sql.includes('schema_migrations')) return { rows: [{ version: '0005' }] }
      if (sql.includes('USAGE')) return { rows: [{ can_read_schema: true }] }
      if (sql.includes('CREATE')) return { rows: [{ can_write_schema: true }] }
      if (sql.includes('current_user')) return { rows: [{ current_user: 'varlens_app' }] }
      return { rows: [] }
    })
    const diagnostics = new PostgresHealthDiagnostics({ query } as never, 'Workspace-A')

    await expect(diagnostics.collect()).resolves.toMatchObject({
      ok: true,
      schema: 'Workspace-A',
      currentMigration: '0005'
    })
  })

  it('returns a failed diagnostic instead of throwing', async () => {
    const diagnostics = new PostgresHealthDiagnostics(
      { query: vi.fn(async () => Promise.reject(new Error('permission denied'))) } as never,
      'workspace'
    )

    await expect(diagnostics.collect()).resolves.toMatchObject({
      ok: false,
      schema: 'workspace',
      message: 'permission denied'
    })
  })

  it.each([
    [
      '28P01',
      'PostgreSQL authentication failed. Check the username and password for this profile.'
    ],
    ['3D000', 'PostgreSQL database does not exist. Check the configured database name.'],
    [
      '42501',
      'PostgreSQL user has insufficient privilege. Check the role grants for this database and schema.'
    ],
    ['3F000', 'PostgreSQL schema does not exist. Check the configured schema name.']
  ])('classifies PostgreSQL error code %s with an actionable message', (code, expected) => {
    const error = Object.assign(new Error('raw database failure'), { code })

    expect(classifyPostgresFailureMessage(error)).toBe(expected)
  })

  it.each([
    Object.assign(new Error('connection timed out'), { code: 'ETIMEDOUT' }),
    Object.assign(new Error('getaddrinfo ENOTFOUND db.internal'), { code: 'ENOTFOUND' }),
    Object.assign(new Error('getaddrinfo EAI_AGAIN db.internal'), { code: 'EAI_AGAIN' }),
    Object.assign(new Error('Connection terminated due to connection timeout')),
    Object.assign(new Error('timeout exceeded when trying to connect'))
  ])('classifies connection timeout and DNS errors as unavailable', (error) => {
    expect(classifyPostgresFailureMessage(error)).toBe(
      'PostgreSQL connection unavailable. Check the host, port, network, and server availability.'
    )
  })

  it('redacts secrets from classified PostgreSQL failures', () => {
    const error = Object.assign(
      new Error(
        [
          'password authentication failed for user "alice"',
          'postgres://alice:super-secret-password@db.internal:5432/varlens',
          '-----BEGIN CERTIFICATE-----\nsecret-ca-body\n-----END CERTIFICATE-----'
        ].join('\n')
      ),
      { code: '28P01' }
    )

    const message = classifyPostgresFailureMessage(error)

    expect(message).toContain('authentication failed')
    expect(message).not.toContain('super-secret-password')
    expect(message).not.toContain('postgres://')
    expect(message).not.toContain('secret-ca-body')
    expect(message).not.toContain('BEGIN CERTIFICATE')
  })

  it('returns actionable redacted messages for failed diagnostics', async () => {
    const diagnostics = new PostgresHealthDiagnostics(
      {
        query: vi.fn(async () =>
          Promise.reject(
            Object.assign(
              new Error(
                'permission denied for schema workspace password=super-secret postgres://alice:super-secret@db/varlens'
              ),
              { code: '42501' }
            )
          )
        )
      } as never,
      'workspace'
    )

    const result = await diagnostics.collect()

    expect(result).toMatchObject({
      ok: false,
      schema: 'workspace',
      message:
        'PostgreSQL user has insufficient privilege. Check the role grants for this database and schema.'
    })
    expect(result.message).not.toContain('super-secret')
    expect(result.message).not.toContain('postgres://')
  })
})
