/**
 * Migration v56 (#586, mirrors PG 0039): variants.ps, the VCF phase set id.
 * A fresh database and one upgraded from v54 both have it; rows kept from
 * before have none. PostgreSQL part gated by VARLENS_RUN_POSTGRES_E2E=1.
 */
import { randomBytes } from 'node:crypto'

import Database from 'better-sqlite3-multiple-ciphers'
import { Pool } from 'pg'
import { describe, expect, it } from 'vitest'

import { LATEST_SQLITE_SCHEMA_VERSION, runMigrations } from '../../../src/main/database/migrations'
import { initializeSchema } from '../../../src/main/database/schema'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'

const RUN_PG = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

const hasPs = (db: InstanceType<typeof Database>): boolean =>
  (db.prepare('PRAGMA table_info(variants)').all() as { name: string }[]).some(
    (c) => c.name === 'ps'
  )

describe('migration v56: variants.ps', () => {
  it('a fresh database has the column', () => {
    const db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
    expect(hasPs(db)).toBe(true)
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SQLITE_SCHEMA_VERSION)
    db.close()
  })

  it('a v54 database gains it; existing rows read NULL', () => {
    const db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
    db.exec(`ALTER TABLE variants DROP COLUMN ps;
      INSERT INTO cases (id, name, file_path, file_size, variant_count, created_at)
        VALUES (1, 'old', '/o', 1, 1, 0);
      INSERT INTO variants (case_id, chr, pos, ref, alt, gt_num) VALUES (1, 'chr1', 5, 'A', 'G', '0|1');
      PRAGMA user_version = 54;`)
    runMigrations(db)
    expect(hasPs(db)).toBe(true)
    expect(db.prepare('SELECT ps FROM variants').get()).toEqual({ ps: null })
    db.close()
  })
})

describe.skipIf(!RUN_PG)('migration 0039: variants.ps on PostgreSQL', () => {
  it('exposes ps on the table and the variants view', async () => {
    const schema = `vt_0039_${randomBytes(4).toString('hex')}`
    const pool = new Pool({ connectionString: PG_URL, max: 2 })
    try {
      await pool.query(`CREATE SCHEMA "${schema}"`)
      await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
      const columns = await pool.query<{ table_name: string; data_type: string }>(
        `SELECT table_name, data_type FROM information_schema.columns
          WHERE table_schema = $1 AND column_name = 'ps' ORDER BY table_name`,
        [schema]
      )
      expect(columns.rows).toEqual([
        { table_name: 'variants', data_type: 'bigint' },
        { table_name: 'variants_all', data_type: 'bigint' }
      ])
    } finally {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await pool.end()
    }
  }, 180_000)
})
