import { describe, expect, it, vi } from 'vitest'

import { quoteIdentifier } from '../../../src/main/storage/postgres/identifiers'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import type { PostgresMigration } from '../../../src/main/storage/postgres/migrations/types'

function poolWithAppliedRows(appliedRows: unknown[] = []) {
  const client = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("current_setting('lock_timeout')")) {
        return { rows: [{ lock_timeout: '5s' }] }
      }

      return {
        rows: sql.includes('SELECT version, checksum') ? appliedRows : []
      }
    }),
    release: vi.fn()
  }
  const connect = vi.fn(async () => client)
  return { query: vi.fn(), connect, client }
}

function sqlCalls(pool: ReturnType<typeof poolWithAppliedRows>): string[] {
  return pool.client.query.mock.calls
    .map(([sql]) => sql)
    .filter((sql): sql is string => typeof sql === 'string')
}

describe('PostgresMigrationRunner', () => {
  const migrations: PostgresMigration[] = [
    {
      version: '0001',
      name: 'one',
      sql: 'CREATE TABLE "__schema__"."one" (id bigint)',
      checksum: 'a'
    },
    {
      version: '0002',
      name: 'two',
      sql: 'CREATE TABLE "__schema__"."two" (id bigint)',
      checksum: 'b'
    }
  ]

  it('creates schema_migrations and applies pending migrations in order', async () => {
    const pool = poolWithAppliedRows()
    const runner = new PostgresMigrationRunner(pool as never, 'app_schema', migrations)

    const result = await runner.migrate()

    expect(result.applied).toEqual(['0001', '0002'])
    expect(result.beforeVersion).toBeNull()
    expect(result.schema).toBe('app_schema')
    expect(pool.connect).toHaveBeenCalledTimes(1)
    expect(pool.client.query).toHaveBeenCalledWith(
      expect.stringContaining('CREATE SCHEMA IF NOT EXISTS "app_schema"')
    )
    expect(pool.client.query).toHaveBeenCalledWith(expect.stringContaining('BEGIN'))
    // Only 0023 lifted the server timeout itself; a long backfill in any other must survive too.
    expect(pool.client.query).toHaveBeenCalledWith(
      "SELECT set_config('statement_timeout', '0', true)"
    )
    expect(pool.client.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
      ['app_schema']
    )
    const lockOrder = pool.client.query.mock.invocationCallOrder.find((_, index) => {
      const [sql] = pool.client.query.mock.calls[index] ?? []
      return typeof sql === 'string' && sql.includes('pg_advisory_xact_lock')
    })
    const createSchemaOrder = pool.client.query.mock.invocationCallOrder.find((_, index) => {
      const [sql] = pool.client.query.mock.calls[index] ?? []
      return typeof sql === 'string' && sql.includes('CREATE SCHEMA')
    })
    expect(lockOrder).toBeLessThan(createSchemaOrder)
    expect(pool.client.query).toHaveBeenCalledWith(expect.stringContaining('COMMIT'))
    expect(pool.client.release).toHaveBeenCalledTimes(1)
  })

  it('waits for advisory migration locks without the query lock timeout', async () => {
    const pool = poolWithAppliedRows()
    const runner = new PostgresMigrationRunner(pool as never, 'app_schema', migrations)

    await runner.migrate()

    expect(pool.client.query).toHaveBeenCalledWith(
      "SELECT current_setting('lock_timeout') AS lock_timeout"
    )
    expect(pool.client.query).toHaveBeenCalledWith("SELECT set_config('lock_timeout', '0', true)")
    expect(pool.client.query).toHaveBeenCalledWith("SELECT set_config('lock_timeout', $1, true)", [
      '5s'
    ])

    const disableTimeoutOrder = pool.client.query.mock.invocationCallOrder.find((_, index) => {
      const [sql] = pool.client.query.mock.calls[index] ?? []
      return sql === "SELECT set_config('lock_timeout', '0', true)"
    })
    const schemaLockOrder = pool.client.query.mock.invocationCallOrder.find((_, index) => {
      const [sql, params] = pool.client.query.mock.calls[index] ?? []
      return (
        typeof sql === 'string' && sql.includes('pg_advisory_xact_lock') && Array.isArray(params)
      )
    })
    const restoreTimeoutOrder = pool.client.query.mock.invocationCallOrder.find((_, index) => {
      const [sql] = pool.client.query.mock.calls[index] ?? []
      return sql === "SELECT set_config('lock_timeout', $1, true)"
    })
    const createSchemaOrder = pool.client.query.mock.invocationCallOrder.find((_, index) => {
      const [sql] = pool.client.query.mock.calls[index] ?? []
      return typeof sql === 'string' && sql.includes('CREATE SCHEMA')
    })

    expect(disableTimeoutOrder).toBeLessThan(schemaLockOrder)
    expect(schemaLockOrder).toBeLessThan(restoreTimeoutOrder)
    expect(restoreTimeoutOrder).toBeLessThan(createSchemaOrder)
  })

  it.each(['workspace_a', 'Case Lab', 'clinical-1'])(
    'quotes schema identifiers when generating migration SQL for %s',
    async (schema) => {
      const pool = poolWithAppliedRows()
      const runner = new PostgresMigrationRunner(pool as never, schema, migrations)
      const quotedSchema = quoteIdentifier(schema)

      await runner.migrate()

      const queries = sqlCalls(pool)
      expect(queries).toEqual(
        expect.arrayContaining([
          expect.stringContaining(`CREATE SCHEMA IF NOT EXISTS ${quotedSchema}`),
          expect.stringContaining(`CREATE TABLE IF NOT EXISTS ${quotedSchema}."schema_migrations"`),
          expect.stringContaining(
            `SELECT version, checksum FROM ${quotedSchema}."schema_migrations"`
          ),
          expect.stringContaining(`CREATE TABLE ${quotedSchema}."one"`),
          expect.stringContaining(`CREATE TABLE ${quotedSchema}."two"`),
          expect.stringContaining(`INSERT INTO ${quotedSchema}."schema_migrations"`)
        ])
      )

      for (const query of queries) {
        expect(query).not.toContain(`CREATE SCHEMA IF NOT EXISTS ${schema}`)
        expect(query).not.toContain(`CREATE TABLE IF NOT EXISTS ${schema}.`)
        expect(query).not.toContain(`SELECT version, checksum FROM ${schema}.`)
        expect(query).not.toContain(`CREATE TABLE ${schema}.`)
        expect(query).not.toContain(`INSERT INTO ${schema}.`)
      }
    }
  )

  it('reports the latest applied version before applying pending migrations', async () => {
    const pool = poolWithAppliedRows([{ version: '0001', checksum: 'a' }])
    const runner = new PostgresMigrationRunner(pool as never, 'app_schema', migrations)

    const result = await runner.migrate()

    expect(result.beforeVersion).toBe('0001')
    expect(result.currentVersion).toBe('0002')
    expect(result.applied).toEqual(['0002'])
    expect(result.schema).toBe('app_schema')
  })

  it('runs migration afterApply hooks inside the migration transaction', async () => {
    const pool = poolWithAppliedRows()
    const afterApply = vi.fn(async () => undefined)
    const runner = new PostgresMigrationRunner(pool as never, 'app_schema', [
      {
        version: '0001',
        name: 'with_hook',
        sql: 'CREATE TABLE "__schema__"."hooked" (id bigint)',
        checksum: 'hook',
        afterApply
      }
    ])

    await runner.migrate()

    expect(afterApply).toHaveBeenCalledWith(pool.client, 'app_schema')
    const hookOrder = afterApply.mock.invocationCallOrder[0]
    const migrationRowOrder = pool.client.query.mock.invocationCallOrder.find((_, index) => {
      const [sql] = pool.client.query.mock.calls[index] ?? []
      return typeof sql === 'string' && sql.includes('INSERT INTO "app_schema"."schema_migrations"')
    })
    const commitOrder = pool.client.query.mock.invocationCallOrder.find((_, index) => {
      const [sql] = pool.client.query.mock.calls[index] ?? []
      return sql === 'COMMIT'
    })

    expect(hookOrder).toBeLessThan(migrationRowOrder)
    expect(migrationRowOrder).toBeLessThan(commitOrder)
  })

  it('throws when an applied migration checksum differs', async () => {
    const pool = poolWithAppliedRows([{ version: '0001', checksum: 'old' }])
    const runner = new PostgresMigrationRunner(pool as never, 'public', migrations)

    await expect(runner.migrate()).rejects.toThrow('checksum mismatch')
  })

  it('throws when the database has a migration newer than this app supports', async () => {
    const pool = poolWithAppliedRows([{ version: '9999', checksum: 'future' }])
    const runner = new PostgresMigrationRunner(pool as never, 'public', migrations)

    await expect(runner.migrate()).rejects.toThrow('newer than this app supports')
  })

  it('rolls back failed migration SQL without masking the migration error', async () => {
    const migrationError = new Error('boom')
    const rollbackError = new Error('rollback boom')
    const pool = poolWithAppliedRows()
    pool.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('CREATE TABLE "public"."one"')) throw migrationError
      if (sql === 'ROLLBACK') throw rollbackError
      return { rows: [] }
    })
    const runner = new PostgresMigrationRunner(pool as never, 'public', migrations)

    await expect(runner.migrate()).rejects.toThrow('boom')
    expect(pool.client.query).toHaveBeenCalledWith('ROLLBACK')
    expect((migrationError as Error & { rollbackError?: unknown }).rollbackError).toBe(
      rollbackError
    )
    expect(pool.client.release).toHaveBeenCalledTimes(1)
  })

  describe('client-side query timeout', () => {
    /**
     * node-postgres arms its "Query read timeout" from
     * `config.query_timeout || client.connectionParameters.query_timeout`
     * (pg/lib/client.js) — the pool's 30 s. A property set on the client
     * itself is never read.
     */
    function poolWithTimeout(failOn?: string) {
      const seen: number[] = []
      const client = {
        connectionParameters: { query_timeout: 30_000 },
        query: vi.fn(async (sql: string) => {
          seen.push(client.connectionParameters.query_timeout)
          if (failOn !== undefined && sql.includes(failOn)) throw new Error('migration failed')
          if (sql.includes("current_setting('lock_timeout')")) {
            return { rows: [{ lock_timeout: '5s' }] }
          }
          return { rows: [] }
        }),
        release: vi.fn()
      }
      return { pool: { query: vi.fn(), connect: vi.fn(async () => client) }, client, seen }
    }

    it('is lifted for every statement of a migration and restored on the pooled client', async () => {
      const { pool, client, seen } = poolWithTimeout()

      await new PostgresMigrationRunner(pool as never, 'app_schema', migrations).migrate()

      // A long backfill (0023 on a large cohort) must not die after 30 s.
      expect(seen.length).toBeGreaterThan(0)
      expect(new Set(seen)).toEqual(new Set([0]))
      expect(client.connectionParameters.query_timeout).toBe(30_000)
      expect(client.release).toHaveBeenCalledTimes(1)
    })

    it('is restored after a failed migration too', async () => {
      const { pool, client } = poolWithTimeout('"one"')

      await expect(
        new PostgresMigrationRunner(pool as never, 'app_schema', migrations).migrate()
      ).rejects.toThrow(/migration failed/)

      expect(client.connectionParameters.query_timeout).toBe(30_000)
    })
  })
})
