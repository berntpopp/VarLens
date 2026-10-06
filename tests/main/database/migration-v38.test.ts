import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { initializeSchema } from '../../../src/main/database/schema'
import { LATEST_SQLITE_SCHEMA_VERSION, runMigrations } from '../../../src/main/database/migrations'

/**
 * v38 rebuilds `users` for the viewer / analyst / admin role model (mirrors
 * Postgres 0024): legacy `user` rows become `analyst`, the default becomes
 * `viewer`, ids and the self-referencing created_by survive.
 */
describe('Migration v38: viewer / analyst / admin roles', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    initializeSchema(db)
    runMigrations(db)
    // Put the users table back into its v12..v35 shape with legacy rows.
    db.exec(`
      DROP TABLE users;
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
        is_active INTEGER NOT NULL DEFAULT 1,
        must_change_password INTEGER NOT NULL DEFAULT 0,
        failed_login_count INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        password_changed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_by INTEGER REFERENCES users(id),
        updated_at TEXT
      );
      INSERT INTO users (id, username, password_hash, role) VALUES (1, 'root', 'h1', 'admin');
      INSERT INTO users (id, username, password_hash, role, created_by)
        VALUES (7, 'clinician', 'h2', 'user', 1);
    `)
    db.pragma('user_version = 35')
    runMigrations(db)
  })

  afterEach(() => {
    db.close()
  })

  it('lands at the latest schema version', () => {
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SQLITE_SCHEMA_VERSION)
  })

  it('maps legacy user to analyst and keeps admins, ids and created_by', () => {
    const rows = db.prepare('SELECT id, username, role, created_by FROM users ORDER BY id').all()
    expect(rows).toEqual([
      { id: 1, username: 'root', role: 'admin', created_by: null },
      { id: 7, username: 'clinician', role: 'analyst', created_by: 1 }
    ])
    expect(db.pragma('foreign_key_check')).toEqual([])
  })

  it('enforces the new enum, defaults to viewer and keeps AUTOINCREMENT ids', () => {
    expect(() =>
      db
        .prepare("INSERT INTO users (username, password_hash, role) VALUES ('x', 'h', 'user')")
        .run()
    ).toThrow(/CHECK constraint failed/)
    const inserted = db
      .prepare("INSERT INTO users (username, password_hash) VALUES ('newbie', 'h')")
      .run()
    expect(Number(inserted.lastInsertRowid)).toBe(8)
    expect(db.prepare("SELECT role FROM users WHERE username = 'newbie'").get()).toEqual({
      role: 'viewer'
    })
  })

  it('is idempotent once applied', () => {
    runMigrations(db)
    expect(db.prepare('SELECT COUNT(*) AS c FROM users').get()).toEqual({ c: 2 })
  })
})
