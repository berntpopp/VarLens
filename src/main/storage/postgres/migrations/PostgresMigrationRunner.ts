import type { Pool, PoolClient } from 'pg'

import { quoteIdentifier } from '../identifiers'
import type { PostgresMigration, PostgresMigrationResult } from './types'

interface MigrationRow {
  version: string
  checksum: string
}

type MigrationPool = Pick<Pool, 'connect'>
type MigrationClient = Pick<PoolClient, 'query' | 'release'>

export class PostgresMigrationRunner {
  private readonly schemaName: string
  private readonly ledger: string

  constructor(
    private readonly pool: MigrationPool,
    private readonly schema: string,
    private readonly migrations: readonly PostgresMigration[],
    // The migration ledger table. A separate track (e.g. the public annotation DB)
    // uses its own ledger so its versions never appear in — and fail the validation
    // of — the main app's `schema_migrations`, even when they share a schema.
    ledgerTable = 'schema_migrations'
  ) {
    this.schemaName = quoteIdentifier(schema)
    this.ledger = quoteIdentifier(ledgerTable)
  }

  async migrate(): Promise<PostgresMigrationResult> {
    const client: MigrationClient = await this.pool.connect()
    let transactionStarted = false

    try {
      await client.query('BEGIN')
      transactionStarted = true
      await this.acquireMigrationLocks(client)
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${this.schemaName}`)
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.schemaName}.${this.ledger} (
          version TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          checksum TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          execution_ms BIGINT NOT NULL
        )
      `)

      const appliedResult = await client.query<MigrationRow>(
        `SELECT version, checksum FROM ${this.schemaName}.${this.ledger} ORDER BY version`
      )
      const applied = new Map(appliedResult.rows.map((row) => [row.version, row.checksum]))
      this.validateAppliedMigrations(applied)
      const beforeVersion = appliedResult.rows[appliedResult.rows.length - 1]?.version ?? null

      const appliedNow: string[] = []
      for (const migration of this.migrations) {
        if (applied.has(migration.version)) continue

        const startedAt = Date.now()
        await client.query(this.interpolateSchema(migration.sql))
        if (migration.afterApply !== undefined) {
          await migration.afterApply(client, this.schema)
        }
        await client.query(
          `INSERT INTO ${this.schemaName}.${this.ledger} (version, name, checksum, execution_ms)
           VALUES ($1, $2, $3, $4)`,
          [migration.version, migration.name, migration.checksum, Date.now() - startedAt]
        )
        appliedNow.push(migration.version)
      }

      await client.query('COMMIT')
      transactionStarted = false

      const current = this.migrations[this.migrations.length - 1]?.version ?? null
      return {
        beforeVersion,
        applied: appliedNow,
        currentVersion: current,
        schema: this.schema
      }
    } catch (error) {
      if (transactionStarted) {
        await this.rollbackPreservingError(client, error)
      }
      throw error
    } finally {
      client.release()
    }
  }

  private async acquireMigrationLocks(client: MigrationClient): Promise<void> {
    const lockTimeoutResult = await client.query<{ lock_timeout: string }>(
      "SELECT current_setting('lock_timeout') AS lock_timeout"
    )
    const lockTimeout = lockTimeoutResult.rows[0]?.lock_timeout ?? '0'

    await client.query("SELECT set_config('lock_timeout', '0', true)")
    // Some migrations touch database-global objects such as extensions.
    // PostgreSQL can race on concurrent CREATE EXTENSION IF NOT EXISTS calls,
    // so keep cross-schema migration runners serialized before schema DDL.
    await client.query('SELECT pg_advisory_xact_lock(928714, 0)')
    await client.query('SELECT pg_advisory_xact_lock(928714, hashtext($1))', [this.schema])
    await client.query("SELECT set_config('lock_timeout', $1, true)", [lockTimeout])
  }

  private validateAppliedMigrations(applied: Map<string, string>): void {
    const knownVersions = new Set(this.migrations.map((migration) => migration.version))
    for (const [version, checksum] of applied) {
      if (!knownVersions.has(version)) {
        throw new Error(`PostgreSQL migration version ${version} is newer than this app supports`)
      }

      const migration = this.migrations.find((candidate) => candidate.version === version)
      if (migration !== undefined && migration.checksum !== checksum) {
        throw new Error(`PostgreSQL migration checksum mismatch for ${version}`)
      }
    }
  }

  private async rollbackPreservingError(client: MigrationClient, error: unknown): Promise<void> {
    try {
      await client.query('ROLLBACK')
    } catch (rollbackError) {
      if (error instanceof Error) {
        const errorWithRollback = error as Error & { rollbackError?: unknown }
        errorWithRollback.rollbackError = rollbackError
        return
      }

      const combinedError = new Error(
        'PostgreSQL migration failed and rollback failed'
      ) as Error & {
        errors: unknown[]
      }
      combinedError.errors = [error, rollbackError]
      throw combinedError
    }
  }

  private interpolateSchema(sql: string): string {
    return sql.split('"__schema__"').join(this.schemaName)
  }
}
