/**
 * Migration v59 (#600, mirrors PG 0042): case_phenotype_scores and
 * case_phenotype_state, both deleted with their case. PostgreSQL part gated by
 * VARLENS_RUN_POSTGRES_E2E=1.
 */
import { randomBytes } from 'node:crypto'

import Database from 'better-sqlite3-multiple-ciphers'
import { Pool } from 'pg'
import { describe, expect, it } from 'vitest'

import { deleteCaseSqls } from '../../../src/main/database/case-dependents'
import { LATEST_SQLITE_SCHEMA_VERSION, runMigrations } from '../../../src/main/database/migrations'
import { initializeSchema } from '../../../src/main/database/schema'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'

const RUN_PG = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

describe('migration v59: stored phenotype scores', () => {
  it('a v58 database gains both tables; a case delete removes its rows', () => {
    const db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
    db.exec(`DROP TABLE case_phenotype_scores; DROP TABLE case_phenotype_state;
      PRAGMA user_version = 58;`)
    runMigrations(db)
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SQLITE_SCHEMA_VERSION)
    db.exec(`INSERT INTO cases (id, name, file_path, file_size, variant_count, created_at)
        VALUES (1, 'c', '/c', 1, 0, 0);
      INSERT INTO case_phenotype_scores VALUES (1, 'GENE1', 0.5, 'Disease');
      INSERT INTO case_phenotype_state VALUES (1, 'hash', 'key', 0);`)
    // The import worker deletes by hand from every table that references `cases`.
    for (const sql of deleteCaseSqls(db)) db.prepare(sql).run(1)
    const count = (table: string): unknown =>
      db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).pluck().get()
    expect([count('case_phenotype_scores'), count('case_phenotype_state')]).toEqual([0, 0])
    db.close()
  })
})

describe.skipIf(!RUN_PG)('migration 0042: stored phenotype scores on PostgreSQL', () => {
  it('creates both tables, deleted with their case', async () => {
    const schema = `vt_0042_${randomBytes(4).toString('hex')}`
    const pool = new Pool({ connectionString: PG_URL, max: 2 })
    try {
      await pool.query(`CREATE SCHEMA "${schema}"`)
      await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
      const c = await pool.query<{ id: string }>(
        `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
         VALUES ('c', '/c', 1, 0, 'GRCh38') RETURNING id`
      )
      const id = c.rows[0].id
      await pool.query(
        `INSERT INTO "${schema}".case_phenotype_scores VALUES ($1, 'GENE1', 0.5, 'Disease')`,
        [id]
      )
      await pool.query(`INSERT INTO "${schema}".case_phenotype_state VALUES ($1, 'h', 'k', 0)`, [
        id
      ])
      await pool.query(`DELETE FROM "${schema}".cases_all WHERE id = $1`, [id])
      const n = await pool.query(
        `SELECT (SELECT COUNT(*) FROM "${schema}".case_phenotype_scores)::int AS scores,
                (SELECT COUNT(*) FROM "${schema}".case_phenotype_state)::int AS state`
      )
      expect(n.rows[0]).toEqual({ scores: 0, state: 0 })
    } finally {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await pool.end()
    }
  }, 180_000)
})
