/**
 * Migration v58 (#600, mirrors PG 0041): case_hpo_terms.excluded / key.
 * Rows kept from before become present and not key. PostgreSQL part gated by
 * VARLENS_RUN_POSTGRES_E2E=1.
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

describe('migration v58: case_hpo_terms flags', () => {
  it('a v57 database gains them; existing rows read present, not key', () => {
    const db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
    db.exec(`ALTER TABLE case_hpo_terms DROP COLUMN "key";
      ALTER TABLE case_hpo_terms DROP COLUMN excluded;
      INSERT INTO cases (id, name, file_path, file_size, variant_count, created_at)
        VALUES (1, 'old', '/o', 1, 1, 0);
      INSERT INTO case_hpo_terms (case_id, hpo_id, hpo_label, created_at)
        VALUES (1, 'HP:0001250', 'Seizure', 0);
      PRAGMA user_version = 57;`)
    runMigrations(db)
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SQLITE_SCHEMA_VERSION)
    expect(db.prepare('SELECT excluded, "key" FROM case_hpo_terms').get()).toEqual({
      excluded: 0,
      key: 0
    })
    expect(() => db.exec(`UPDATE case_hpo_terms SET excluded = 1, "key" = 1`)).toThrow(
      /CHECK constraint/
    )
    db.close()
  })

  it('recovers a partial v58 (excluded added, key missing)', () => {
    const db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
    db.exec(`ALTER TABLE case_hpo_terms DROP COLUMN "key"; PRAGMA user_version = 57;`)
    runMigrations(db)
    const cols = (db.prepare('PRAGMA table_info(case_hpo_terms)').all() as { name: string }[]).map(
      (c) => c.name
    )
    expect(cols).toEqual(expect.arrayContaining(['excluded', 'key']))
    db.exec(`INSERT INTO cases (id, name, file_path, file_size, variant_count, created_at)
        VALUES (1, 'c', '/c', 1, 1, 0);
      INSERT INTO case_hpo_terms (case_id, hpo_id, hpo_label, created_at)
        VALUES (1, 'HP:0001250', 'Seizure', 0)`)
    expect(() => db.exec(`UPDATE case_hpo_terms SET excluded = 1, "key" = 1`)).toThrow(
      /CHECK constraint/
    )
    db.close()
  })
})

describe.skipIf(!RUN_PG)('migration 0041: case_hpo_terms flags on PostgreSQL', () => {
  it('existing rows read present, not key', async () => {
    const schema = `vt_0041_${randomBytes(4).toString('hex')}`
    const pool = new Pool({ connectionString: PG_URL, max: 2 })
    try {
      await pool.query(`CREATE SCHEMA "${schema}"`)
      const before = POSTGRES_MIGRATIONS.filter((m) => m.version < '0041')
      await new PostgresMigrationRunner(pool, schema, before).migrate()
      const c = await pool.query<{ id: string }>(
        `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
         VALUES ('old', '/o', 1, 0, 'GRCh38') RETURNING id`
      )
      await pool.query(
        `INSERT INTO "${schema}".case_hpo_terms (case_id, hpo_id, hpo_label, created_at)
         VALUES ($1, 'HP:0001250', 'Seizure', 0)`,
        [c.rows[0].id]
      )
      await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
      const rows = await pool.query(`SELECT excluded, "key" FROM "${schema}".case_hpo_terms`)
      expect(rows.rows).toEqual([{ excluded: false, key: false }])
    } finally {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await pool.end()
    }
  }, 180_000)
})
