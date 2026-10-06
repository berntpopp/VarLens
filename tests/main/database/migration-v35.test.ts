import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { initializeSchema } from '../../../src/main/database/schema'
import { LATEST_SQLITE_SCHEMA_VERSION, runMigrations } from '../../../src/main/database/migrations'

/**
 * v35 backfills case_data_info rows that the worker import path failed to
 * write (it omitted the NOT NULL created_at/updated_at columns from 2026-03
 * until the fix landed, so every desktop import since then has no row).
 */
describe('Migration v35: case_data_info backfill', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
  })

  afterEach(() => {
    db.close()
  })

  function addCase(name: string, filePath: string, createdAt: number): number {
    return Number(
      db
        .prepare(
          'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, 1, 0, ?)'
        )
        .run(name, filePath, createdAt).lastInsertRowid
    )
  }

  function rerunFrom(version: number): void {
    db.pragma(`user_version = ${version}`)
    runMigrations(db)
  }

  it('lands at the latest schema version', () => {
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SQLITE_SCHEMA_VERSION)
  })

  it('inserts a provenance row for every case without one', () => {
    const vcfCase = addCase('a', '/data/run1/sample.vcf.gz', 1111)
    const jsonCase = addCase('b', 'C:\\data\\sample.json', 2222)
    rerunFrom(32)

    const rows = db
      .prepare(
        'SELECT case_id, import_file_name, import_file_type, created_at, updated_at FROM case_data_info ORDER BY case_id'
      )
      .all() as Array<Record<string, unknown>>
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      case_id: vcfCase,
      import_file_name: 'sample.vcf.gz',
      import_file_type: 'vcf',
      created_at: 1111
    })
    expect(rows[1]).toMatchObject({
      case_id: jsonCase,
      import_file_name: 'sample.json',
      import_file_type: null,
      created_at: 2222
    })
    expect(rows[1].updated_at as number).toBeGreaterThanOrEqual(2222)
  })

  it('leaves existing rows untouched and is idempotent', () => {
    const caseId = addCase('a', '/x/orig.vcf', 1)
    db.prepare(
      "INSERT INTO case_data_info (case_id, import_file_name, import_file_type, platform, created_at, updated_at) VALUES (?, 'orig.vcf', 'vcf', 'WGS', 7, 8)"
    ).run(caseId)
    rerunFrom(32)
    rerunFrom(32)

    const rows = db.prepare('SELECT * FROM case_data_info').all() as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ platform: 'WGS', created_at: 7, updated_at: 8 })
  })
})
