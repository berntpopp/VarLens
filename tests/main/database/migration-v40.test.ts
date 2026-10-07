/**
 * Migration v40: `cases.import_status` ('ready' by default) and its index.
 * Every case that exists when the migration runs is a finished import, so it
 * must come out 'ready'; the migration must be safe to run again, on the
 * legacy `cases` shapes older migration tests start from, and through
 * SQLCipher.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseService } from '../../../src/main/database/DatabaseService'
import { initializeSchema } from '../../../src/main/database/schema'
import { LATEST_SQLITE_SCHEMA_VERSION, runMigrations } from '../../../src/main/database/migrations'

const INDEX = 'idx_cases_import_status'

const caseColumn = (db: Database.Database): { dflt_value: string; notnull: number } | undefined =>
  (
    db.prepare("PRAGMA table_info('cases')").all() as Array<{
      name: string
      dflt_value: string
      notnull: number
    }>
  ).find((column) => column.name === 'import_status')

const indexColumns = (db: Database.Database): string[] =>
  (db.prepare(`PRAGMA index_info('${INDEX}')`).all() as Array<{ name: string }>).map((c) => c.name)

const statuses = (db: Database.Database): unknown[] =>
  db.prepare('SELECT name, import_status FROM cases ORDER BY name').all()

/** Take a current database back to what v39 looked like. */
function rollBackToV39(db: Database.Database): void {
  db.exec(`DROP INDEX ${INDEX}`)
  db.exec('ALTER TABLE cases DROP COLUMN import_status')
  db.pragma('user_version = 39')
}

const INSERT_V39_CASE = `
  INSERT INTO cases (name, file_path, file_size, variant_count, created_at, genome_build)
  VALUES ('old', '/old.vcf', 1, 0, 0, 'GRCh38')`

describe('Migration v40: cases.import_status', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
  })

  afterEach(() => {
    db.close()
  })

  it('is part of the latest schema version', () => {
    expect(LATEST_SQLITE_SCHEMA_VERSION).toBeGreaterThanOrEqual(40)
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SQLITE_SCHEMA_VERSION)
  })

  it('a new database has the NOT NULL column defaulting to ready, and the index', () => {
    expect(caseColumn(db)).toMatchObject({ dflt_value: "'ready'", notnull: 1 })
    expect(indexColumns(db)).toEqual(['import_status', 'genome_build'])
  })

  it('upgrades a v39 database: every existing case is ready', () => {
    rollBackToV39(db)
    db.exec(INSERT_V39_CASE)
    expect(caseColumn(db)).toBeUndefined()

    runMigrations(db)

    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SQLITE_SCHEMA_VERSION)
    expect(statuses(db)).toEqual([{ name: 'old', import_status: 'ready' }])
    expect(indexColumns(db)).toEqual(['import_status', 'genome_build'])
  })

  it('runs again over its own result without touching the data', () => {
    db.exec(INSERT_V39_CASE)
    db.exec("UPDATE cases SET import_status = 'provisional'")
    db.pragma('user_version = 39')

    runMigrations(db)
    db.pragma('user_version = 39')
    runMigrations(db)

    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SQLITE_SCHEMA_VERSION)
    // An interrupted import stays what it is; recovery discards it, not v40.
    expect(statuses(db)).toEqual([{ name: 'old', import_status: 'provisional' }])
    expect(indexColumns(db)).toEqual(['import_status', 'genome_build'])
  })

  it('handles a legacy cases table without genome_build', () => {
    const legacy = new Database(':memory:')
    try {
      legacy.exec('CREATE TABLE cases (id INTEGER PRIMARY KEY, name TEXT)')
      legacy.exec("INSERT INTO cases (name) VALUES ('old')")
      legacy.pragma('user_version = 39')

      runMigrations(legacy)

      expect(legacy.pragma('user_version', { simple: true })).toBe(LATEST_SQLITE_SCHEMA_VERSION)
      expect(statuses(legacy)).toEqual([{ name: 'old', import_status: 'ready' }])
      expect(indexColumns(legacy)).toEqual(['import_status'])
    } finally {
      legacy.close()
    }
  })

  it('handles a database without a cases table', () => {
    const empty = new Database(':memory:')
    try {
      empty.pragma('user_version = 39')
      expect(() => runMigrations(empty)).not.toThrow()
      expect(empty.pragma('user_version', { simple: true })).toBe(LATEST_SQLITE_SCHEMA_VERSION)
    } finally {
      empty.close()
    }
  })

  describe('through SQLCipher', () => {
    const KEY = 'correct horse battery staple'
    let dir: string

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'varlens-migration-v40-'))
    })

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true })
    })

    it('upgrades an encrypted v39 database when it is opened', () => {
      const path = join(dir, 'encrypted.db')
      const created = new DatabaseService(path, KEY)
      rollBackToV39(created.database)
      created.database.exec(INSERT_V39_CASE)
      created.close()

      const reopened = new DatabaseService(path, KEY)
      try {
        expect(reopened.isEncrypted()).toBe(true)
        expect(reopened.database.pragma('user_version', { simple: true })).toBe(LATEST_SQLITE_SCHEMA_VERSION)
        expect(statuses(reopened.database)).toEqual([{ name: 'old', import_status: 'ready' }])
        expect(indexColumns(reopened.database)).toEqual(['import_status', 'genome_build'])
        // A reader that filters on the new column works on it.
        expect(reopened.cases.getAllCases().map((c) => c.name)).toEqual(['old'])
      } finally {
        reopened.close()
      }
    })
  })
})
