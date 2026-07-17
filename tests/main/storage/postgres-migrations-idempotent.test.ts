/**
 * Postgres migrations — real-instance idempotency check.
 *
 * Web ships on Postgres. Migration correctness against a real Postgres engine
 * is therefore load-bearing and the existing migration tests (mock-only) do
 * not cover it.
 *
 * This test boots a real schema, runs all migrations, captures the resulting
 * schema state from information_schema, runs migrations again on the same
 * schema, and asserts the captured state is identical. Catches:
 *
 *   - Migrations that produce different output on a second run (non-idempotent)
 *   - Migrations that depend on Postgres extensions / GUC state we don't ship
 *   - Type/grammar incompatibilities relative to SQLite that the mock tests miss
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires `make pg-up`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { randomBytes } from 'node:crypto'

import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { Pool } from 'pg'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

interface SchemaSnapshot {
  tables: Array<{ table_name: string; columns: string[] }>
  indexes: string[]
  appliedVersions: number[]
}

async function captureSchema(client: Client, schema: string): Promise<SchemaSnapshot> {
  const tablesRes = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
       WHERE table_schema = $1 ORDER BY table_name`,
    [schema]
  )

  const tables: SchemaSnapshot['tables'] = []
  for (const row of tablesRes.rows) {
    const colsRes = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position`,
      [schema, row.table_name]
    )
    tables.push({
      table_name: row.table_name,
      columns: colsRes.rows.map((r) => r.column_name)
    })
  }

  const indexRes = await client.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes
       WHERE schemaname = $1 ORDER BY indexname`,
    [schema]
  )

  const versionsRes = await client.query<{ version: number }>(
    `SELECT version FROM "${schema}".schema_migrations ORDER BY version`
  )

  return {
    tables,
    indexes: indexRes.rows.map((r) => r.indexname),
    appliedVersions: versionsRes.rows.map((r) => r.version)
  }
}

describe.skipIf(!RUN)('Postgres migrations: real-instance idempotency', () => {
  const schema = `varlens_test_mig_${Date.now()}_${randomBytes(4).toString('hex')}`
  let pool: Pool
  let probeClient: Client

  beforeAll(async () => {
    const provisioner = new Client({ connectionString: PG_URL })
    await provisioner.connect()
    await provisioner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await provisioner.end()

    pool = new Pool({ connectionString: PG_URL, max: 2 })
    probeClient = new Client({ connectionString: PG_URL })
    await probeClient.connect()
  }, 60_000)

  afterAll(async () => {
    if (probeClient) await probeClient.end()
    if (pool) await pool.end()

    const cleaner = new Client({ connectionString: PG_URL })
    await cleaner.connect()
    await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    // The central audit table outlives the project schema by design; clean
    // this run's rows the way retention does — owner-only trigger disable.
    try {
      await cleaner.query(
        'ALTER TABLE varlens_audit.audit_log DISABLE TRIGGER audit_log_block_mutation'
      )
      await cleaner.query('DELETE FROM varlens_audit.audit_log WHERE project_schema = $1', [schema])
    } finally {
      await cleaner.query(
        'ALTER TABLE varlens_audit.audit_log ENABLE TRIGGER audit_log_block_mutation'
      )
      await cleaner.end()
    }
  }, 60_000)

  it('runs all migrations end-to-end and produces a non-empty schema', async () => {
    // Stage the run to prove 0013's legacy copy: apply everything below
    // 0013, write a per-schema audit row the old way, then apply the rest.
    const preCentral = POSTGRES_MIGRATIONS.filter((m) => m.version < '0013')
    await new PostgresMigrationRunner(pool, schema, preCentral).migrate()
    await probeClient.query(
      `INSERT INTO "${schema}".audit_log
        (action_type, entity_type, entity_key, new_value, user_name)
       VALUES ('star', 'variant_annotation', '1:100:A:G', '{"starred":1}', 'legacy-user')`
    )

    const throughCentral = POSTGRES_MIGRATIONS.filter((m) => m.version < '0014')
    const centralResult = await new PostgresMigrationRunner(pool, schema, throughCentral).migrate()
    expect(centralResult.applied).toContain('0013')

    const caseResult = await probeClient.query<{ id: string }>(
      `INSERT INTO "${schema}".cases
        (name, file_path, file_size, variant_count, created_at)
       VALUES ('legacy-json-case', '/legacy.json', 100, 1, 0)
       RETURNING id`
    )
    const variantResult = await probeClient.query<{ id: string }>(
      `INSERT INTO "${schema}".variants
        (case_id, chr, pos, ref, alt, consequence, func, transcript)
       VALUES ($1, '1', 101, 'C', 'T', 'LOW', 'synonymous_variant', 'NM_JSON.1')
       RETURNING id`,
      [caseResult.rows[0].id]
    )
    await probeClient.query(
      `INSERT INTO "${schema}".variant_transcripts
        (variant_id, transcript_id, consequence, is_selected)
       VALUES ($1, 'NM_JSON.1', 'LOW', 1)`,
      [variantResult.rows[0].id]
    )

    const result = await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    expect(result.applied).toEqual(['0014', '0015'])

    const migratedTranscript = await probeClient.query<{ consequence: string; func: string }>(
      `SELECT consequence, func
         FROM "${schema}".variant_transcripts
        WHERE variant_id = $1`,
      [variantResult.rows[0].id]
    )
    expect(migratedTranscript.rows).toEqual([{ consequence: 'LOW', func: 'synonymous_variant' }])

    const snapshot = await captureSchema(probeClient, schema)
    expect(snapshot.tables.length).toBeGreaterThan(0)
    expect(snapshot.appliedVersions).toEqual([...snapshot.appliedVersions].sort((a, b) => a - b))

    // Auth tables must materialise after migration. PostgresWebAuthService
    // depends on both being present with the columns the SQLite schema also has.
    const tableNames = snapshot.tables.map((t) => t.table_name)
    expect(tableNames).toContain('users')
    expect(tableNames).toContain('database_settings')

    // Asserting names alone is not enough: a future careless edit could flip
    // is_active/must_change_password back to INTEGER, drop the role CHECK, or
    // drop NOT NULL on password_hash, and this test would still pass.
    // Pin types, nullability, defaults, and the role enum explicitly.
    const colMeta = await probeClient.query<{
      column_name: string
      data_type: string
      udt_name: string
      is_nullable: string
      column_default: string | null
    }>(
      `SELECT column_name, data_type, udt_name, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'users'`,
      [schema]
    )
    const cols = new Map(colMeta.rows.map((r) => [r.column_name, r]))
    const expectColType = (
      name: string,
      udt: string,
      nullable: 'YES' | 'NO',
      hasDefault: boolean
    ): void => {
      const c = cols.get(name)
      expect(c, `users.${name} must exist`).toBeDefined()
      expect(c!.udt_name, `users.${name} udt`).toBe(udt)
      expect(c!.is_nullable, `users.${name} nullability`).toBe(nullable)
      if (hasDefault) {
        expect(c!.column_default, `users.${name} must have a default`).not.toBeNull()
      }
    }
    expectColType('id', 'int8', 'NO', true)
    expectColType('username', 'text', 'NO', false)
    expectColType('display_name', 'text', 'YES', false)
    expectColType('password_hash', 'text', 'NO', false)
    expectColType('role', 'text', 'NO', true)
    expectColType('is_active', 'bool', 'NO', true)
    expectColType('must_change_password', 'bool', 'NO', true)
    expectColType('failed_login_count', 'int4', 'NO', true)
    expectColType('locked_until', 'timestamptz', 'YES', false)
    expectColType('password_changed_at', 'timestamptz', 'YES', false)
    expectColType('created_at', 'timestamptz', 'NO', true)
    expectColType('created_by', 'int8', 'YES', false)
    expectColType('updated_at', 'timestamptz', 'YES', false)

    // Role CHECK must enumerate exactly admin + user, the same enum as SQLite
    // migrations.ts v12. The shared constants module is the cross-backend
    // source of truth.
    const checkRow = await probeClient.query<{ check_clause: string }>(
      `SELECT cc.check_clause
         FROM information_schema.table_constraints tc
         JOIN information_schema.check_constraints cc USING (constraint_schema, constraint_name)
        WHERE tc.table_schema = $1 AND tc.table_name = 'users'
          AND tc.constraint_type = 'CHECK'
          AND cc.check_clause ILIKE '%role%'`,
      [schema]
    )
    expect(checkRow.rows.length, 'users.role CHECK constraint must be present').toBeGreaterThan(0)
    const clauses = checkRow.rows.map((r) => r.check_clause)
    expect(clauses.some((c) => c.includes("'admin'") && c.includes("'user'"))).toBe(true)

    // Unique constraint on username is the auth path's only defence
    // against duplicate-account creation race conditions.
    const uniques = await probeClient.query<{ index_name: string }>(
      `SELECT i.relname AS index_name
         FROM pg_index x
         JOIN pg_class i ON i.oid = x.indexrelid
         JOIN pg_class t ON t.oid = x.indrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = $1 AND t.relname = 'users' AND x.indisunique`,
      [schema]
    )
    expect(
      uniques.rows.length,
      'users must have at least one UNIQUE constraint (username + PK)'
    ).toBeGreaterThanOrEqual(2)

    // 0013 moved the audit trail to the shared varlens_audit schema:
    // the per-project table is gone, its rows are copied over stamped
    // with the project schema, and the action/entity CHECK contract
    // now lives on the central table.
    const legacyTable = await probeClient.query<{ t: string | null }>(
      `SELECT to_regclass($1) AS t`,
      [`"${schema}"."audit_log"`]
    )
    expect(legacyTable.rows[0]?.t).toBeNull()

    const copied = await probeClient.query<{
      entity_key: string
      user_name: string
      new_value: string
    }>(
      `SELECT entity_key, user_name, new_value FROM varlens_audit.audit_log
        WHERE project_schema = $1 AND action_type = 'star'`,
      [schema]
    )
    expect(copied.rows).toEqual([
      { entity_key: '1:100:A:G', user_name: 'legacy-user', new_value: '{"starred":1}' }
    ])

    await probeClient.query(
      `INSERT INTO varlens_audit.audit_log
        (project_schema, action_type, entity_type, entity_key, new_value, user_name, metadata_json)
       VALUES
        ($1, 'auth_login_success', 'user_account', 'admin', '{"success":true}', 'admin', '{"source":"web-auth"}'),
        ($1, 'api_read', 'api_call', 'cases:query', '{"success":true,"method":"cases:query"}', 'admin', '{"source":"web-dispatcher"}'),
        ($1, 'api_write', 'api_call', 'tags:create', '{"success":true,"method":"tags:create"}', 'admin', '{"source":"web-dispatcher"}')`,
      [schema]
    )

    await expect(
      probeClient.query(
        `INSERT INTO varlens_audit.audit_log
          (project_schema, action_type, entity_type, entity_key, new_value)
         VALUES ($1, 'not_a_contract_action', 'api_call', 'x', '{}')`,
        [schema]
      )
    ).rejects.toThrow()
    await expect(
      probeClient.query(
        `INSERT INTO varlens_audit.audit_log
          (project_schema, action_type, entity_type, entity_key, new_value)
         VALUES ($1, 'api_write', 'not_a_contract_entity', 'x', '{}')`,
        [schema]
      )
    ).rejects.toThrow()
  }, 60_000)

  it('is idempotent — a second run produces the same schema state', async () => {
    const before = await captureSchema(probeClient, schema)

    const result = await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    expect(result.applied.length).toBe(0) // nothing new to apply

    const after = await captureSchema(probeClient, schema)
    expect(after).toEqual(before)
  }, 60_000)
})

describe.skipIf(RUN)('Postgres migrations: real-instance idempotency (skipped)', () => {
  it('runs only when VARLENS_RUN_POSTGRES_E2E=1 and `make pg-up` is up', () => {
    expect(RUN).toBe(false)
  })
})
