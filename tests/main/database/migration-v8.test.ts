import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'

describe('Migration v8: age and date_of_birth', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
  })

  it('adds age column to case_metadata', () => {
    const columns = db.pragma('table_info(case_metadata)') as Array<{ name: string }>
    expect(columns.some((c) => c.name === 'age')).toBe(true)
  })

  it('adds date_of_birth column to case_metadata', () => {
    const columns = db.pragma('table_info(case_metadata)') as Array<{ name: string }>
    expect(columns.some((c) => c.name === 'date_of_birth')).toBe(true)
  })

  it('stores and retrieves age', () => {
    const caseId = db
      .prepare(
        "INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES ('test', '/test', 100, 0, ?)"
      )
      .run(Date.now()).lastInsertRowid
    db.prepare(
      'INSERT INTO case_metadata (case_id, affected_status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(caseId, 'affected', '', Date.now(), Date.now())
    db.prepare('UPDATE case_metadata SET age = ? WHERE case_id = ?').run(45.5, caseId)
    const row = db.prepare('SELECT age FROM case_metadata WHERE case_id = ?').get(caseId) as {
      age: number
    }
    expect(row.age).toBe(45.5)
  })

  it('sets schema version to latest after all migrations', () => {
    const result = db.pragma('user_version') as Array<{ user_version: number }>
    expect(result[0].user_version).toBe(16)
  })
})
