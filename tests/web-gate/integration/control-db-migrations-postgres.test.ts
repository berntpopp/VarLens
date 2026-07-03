import { Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import {
  CONTROL_DB_MIGRATIONS,
  POSTGRES_MIGRATIONS
} from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'

const RUN_POSTGRES = Boolean(process.env.VARLENS_PG_URL)

/**
 * A5a — applying the control-scoped migration set must create the routing/auth/audit
 * tables (users) but NOT the case-data tables (variants, cases), while the full set does.
 */
describe.skipIf(!RUN_POSTGRES)('control-scoped migrations - PostgreSQL integration', () => {
  const controlSchema = `ctrl_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
  const fullSchema = `full_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
  let pool: Pool | undefined

  beforeEach(async () => {
    pool = new Pool({ connectionString: process.env.VARLENS_PG_URL, max: 2 })
    await pool.query(`CREATE SCHEMA IF NOT EXISTS "${controlSchema}"`)
    await pool.query(`CREATE SCHEMA IF NOT EXISTS "${fullSchema}"`)
  })

  afterEach(async () => {
    if (pool !== undefined) {
      await pool.query(`DROP SCHEMA IF EXISTS "${controlSchema}" CASCADE`).catch(() => {})
      await pool.query(`DROP SCHEMA IF EXISTS "${fullSchema}" CASCADE`).catch(() => {})
      await pool.end()
      pool = undefined
    }
  })

  const regclass = async (schema: string, table: string): Promise<string | null> => {
    const result = await pool!.query<{ relation: string | null }>(
      'SELECT to_regclass($1) AS relation',
      [`"${schema}"."${table}"`]
    )
    return result.rows[0]?.relation ?? null
  }

  test('control set creates users but not case-data tables; full set creates both', async () => {
    await new PostgresMigrationRunner(pool!, controlSchema, CONTROL_DB_MIGRATIONS).migrate()
    await new PostgresMigrationRunner(pool!, fullSchema, POSTGRES_MIGRATIONS).migrate()

    expect(await regclass(controlSchema, 'users')).not.toBeNull()
    expect(await regclass(controlSchema, 'variants')).toBeNull()
    expect(await regclass(controlSchema, 'cases')).toBeNull()

    expect(await regclass(fullSchema, 'users')).not.toBeNull()
    expect(await regclass(fullSchema, 'variants')).not.toBeNull()
    expect(await regclass(fullSchema, 'cases')).not.toBeNull()
  })
})
