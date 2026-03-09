import Database from 'better-sqlite3-multiple-ciphers'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'

describe('Users table migration', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
  })

  afterEach(() => {
    db.close()
  })

  it('should create users table', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
      .all()
    expect(tables).toHaveLength(1)
  })

  it('should have correct columns', () => {
    const columns = db.prepare('PRAGMA table_info(users)').all() as { name: string }[]
    const names = columns.map((c) => c.name)
    expect(names).toContain('id')
    expect(names).toContain('username')
    expect(names).toContain('password_hash')
    expect(names).toContain('role')
    expect(names).toContain('is_active')
    expect(names).toContain('must_change_password')
    expect(names).toContain('failed_login_count')
    expect(names).toContain('locked_until')
    expect(names).toContain('password_changed_at')
  })

  it('should create database_settings table', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='database_settings'")
      .all()
    expect(tables).toHaveLength(1)
  })

  it('should enforce unique username constraint', () => {
    db.prepare(
      "INSERT INTO users (username, password_hash, role) VALUES ('admin', 'hash1', 'admin')"
    ).run()

    expect(() => {
      db.prepare(
        "INSERT INTO users (username, password_hash, role) VALUES ('admin', 'hash2', 'user')"
      ).run()
    }).toThrow(/UNIQUE constraint failed/)
  })

  it('should enforce role check constraint', () => {
    expect(() => {
      db.prepare(
        "INSERT INTO users (username, password_hash, role) VALUES ('test', 'hash', 'superadmin')"
      ).run()
    }).toThrow()
  })

  it('should allow key-value storage in database_settings', () => {
    db.prepare("INSERT INTO database_settings (key, value) VALUES ('accounts_enabled', 'true')").run()
    const result = db
      .prepare("SELECT value FROM database_settings WHERE key = 'accounts_enabled'")
      .get() as { value: string }
    expect(result.value).toBe('true')
  })
})
