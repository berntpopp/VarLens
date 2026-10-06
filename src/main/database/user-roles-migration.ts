/**
 * SQLite migration v36: viewer / analyst / admin role model.
 *
 * SQLite cannot alter a CHECK constraint in place, so the `users` table is
 * rebuilt (create new → copy → drop → rename), mapping the legacy `user`
 * role to `analyst` (it always had every analyst write ability) and making
 * the least-privileged `viewer` the column default. Ids are copied verbatim,
 * so the self-referencing `created_by` stays valid and AUTOINCREMENT's
 * sqlite_sequence keeps its high-water mark. Mirrors Postgres 0020.
 *
 * Runs in one transaction; a crash mid-rebuild leaves the previous schema intact.
 */
import type Database from 'better-sqlite3-multiple-ciphers'

export function migrateUserRoles(db: Database.Database): void {
  const hasUsers =
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get() !==
    undefined
  if (!hasUsers) return

  const rebuild = db.transaction(() => {
    db.exec(`
      CREATE TABLE users_v36 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('viewer', 'analyst', 'admin')),
        is_active INTEGER NOT NULL DEFAULT 1,
        must_change_password INTEGER NOT NULL DEFAULT 0,
        failed_login_count INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        password_changed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_by INTEGER REFERENCES users(id),
        updated_at TEXT
      );

      INSERT INTO users_v36
        (id, username, display_name, password_hash, role, is_active, must_change_password,
         failed_login_count, locked_until, password_changed_at, created_at, created_by, updated_at)
      SELECT id, username, display_name, password_hash,
             CASE role WHEN 'user' THEN 'analyst' ELSE role END,
             is_active, must_change_password, failed_login_count, locked_until,
             password_changed_at, created_at, created_by, updated_at
        FROM users;

      DROP TABLE users;
      ALTER TABLE users_v36 RENAME TO users;

      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    `)
    const violations = db.pragma('foreign_key_check(users)') as unknown[]
    if (violations.length > 0) {
      throw new Error(`users rebuild left ${violations.length} foreign-key violation(s)`)
    }
  })

  // SQLite's documented table-rebuild procedure: FK enforcement must be off
  // (it cannot change inside a transaction), otherwise DROP TABLE users
  // cascades into users_v36.created_by, which points at the old table until
  // the rename. Integrity is re-checked explicitly before COMMIT instead.
  const fkWasOn = db.pragma('foreign_keys', { simple: true }) === 1
  if (fkWasOn) db.pragma('foreign_keys = OFF')
  try {
    rebuild()
  } finally {
    if (fkWasOn) db.pragma('foreign_keys = ON')
  }
}
