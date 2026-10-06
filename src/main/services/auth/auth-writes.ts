/**
 * Every write the desktop AuthService performs, as a typed operation.
 *
 * In the app these run on the single SQLite writer thread (write-worker.ts)
 * via `SqliteWriteExecutor.executeAuthWrite`, so a login or user-admin write
 * that has to wait for an import/delete lock never blocks the Electron main
 * thread (audit 05, M-4 follow-up). `applyAuthWrite` is the one executor,
 * used by the worker and by the in-process fallback alike.
 *
 * DB-only module (no Electron / MainLogger): loaded inside the write worker.
 */
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { ROLE_ADMIN, ROLE_USER, type UserRole } from '../../../shared/auth/auth-constants'

export type AuthWriteOp =
  | { op: 'recordFailedLogin'; userId: number; count: number; lockedUntil: string | null }
  | { op: 'clearFailedLogins'; userId: number }
  | {
      op: 'createFirstUser'
      username: string
      displayName: string
      passwordHash: string
      recoveryKeyHash: string
    }
  | {
      op: 'createUser'
      username: string
      displayName: string
      passwordHash: string
      creatorUsername?: string
    }
  | { op: 'setActive'; username: string; active: boolean }
  | { op: 'setRole'; username: string; role: UserRole }
  | { op: 'resetPassword'; username: string; passwordHash: string }
  | { op: 'changePassword'; username: string; passwordHash: string }

/** Result shapes: `{ id }` for inserts, `{ changes }` for updates. */
export type AuthWriteResult = { id: number } | { changes: number }

function changes(db: DatabaseType, sql: string, ...params: unknown[]): AuthWriteResult {
  return { changes: db.prepare(sql).run(...params).changes }
}

function createFirstUser(
  db: DatabaseType,
  op: Extract<AuthWriteOp, { op: 'createFirstUser' }>
): AuthWriteResult {
  return db.transaction(() => {
    const existing = db.prepare('SELECT id FROM users WHERE role = ? LIMIT 1').get(ROLE_ADMIN)
    if (existing !== undefined) throw new Error('Admin user already exists')
    db.prepare('INSERT INTO database_settings (key, value) VALUES (?, ?)').run(
      'recovery_key_hash',
      op.recoveryKeyHash
    )
    db.prepare(
      "INSERT OR REPLACE INTO database_settings (key, value) VALUES ('accounts_enabled', 'true')"
    ).run()
    const result = db
      .prepare(
        `INSERT INTO users (username, display_name, password_hash, role, password_changed_at)
         VALUES (?, ?, ?, ?, datetime('now'))`
      )
      .run(op.username, op.displayName, op.passwordHash, ROLE_ADMIN)
    return { id: Number(result.lastInsertRowid) }
  })()
}

function createUser(
  db: DatabaseType,
  op: Extract<AuthWriteOp, { op: 'createUser' }>
): AuthWriteResult {
  const creator =
    op.creatorUsername !== undefined
      ? (db.prepare('SELECT id FROM users WHERE username = ?').get(op.creatorUsername) as
          { id: number } | undefined)
      : undefined
  const result = db
    .prepare(
      `INSERT INTO users (username, display_name, password_hash, role, must_change_password, created_by, password_changed_at)
       VALUES (?, ?, ?, ?, 1, ?, datetime('now'))`
    )
    .run(op.username, op.displayName, op.passwordHash, ROLE_USER, creator?.id ?? null)
  return { id: Number(result.lastInsertRowid) }
}

/** Role change; never demotes the last active admin (checked inside the write). */
function setRole(db: DatabaseType, op: Extract<AuthWriteOp, { op: 'setRole' }>): AuthWriteResult {
  return db.transaction(() => {
    const user = db.prepare('SELECT role FROM users WHERE username = ?').get(op.username) as
      { role: string } | undefined
    if (user === undefined) throw new Error(`User not found: ${op.username}`)
    if (user.role === op.role) return { changes: 0 }
    if (user.role === ROLE_ADMIN) {
      const others = db
        .prepare(
          'SELECT COUNT(*) AS c FROM users WHERE role = ? AND is_active = 1 AND username <> ?'
        )
        .get(ROLE_ADMIN, op.username) as { c: number }
      if (others.c === 0) throw new Error('Cannot demote the last active admin')
    }
    return changes(
      db,
      "UPDATE users SET role = ?, updated_at = datetime('now') WHERE username = ?",
      op.role,
      op.username
    )
  })()
}

export function applyAuthWrite(db: DatabaseType, op: AuthWriteOp): AuthWriteResult {
  switch (op.op) {
    case 'recordFailedLogin':
      return changes(
        db,
        'UPDATE users SET failed_login_count = ?, locked_until = COALESCE(?, locked_until) WHERE id = ?',
        op.count,
        op.lockedUntil,
        op.userId
      )
    case 'clearFailedLogins':
      return changes(
        db,
        'UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = ?',
        op.userId
      )
    case 'createFirstUser':
      return createFirstUser(db, op)
    case 'createUser':
      return createUser(db, op)
    case 'setActive':
      return op.active
        ? changes(
            db,
            `UPDATE users SET is_active = 1, failed_login_count = 0, locked_until = NULL,
             updated_at = datetime('now') WHERE username = ?`,
            op.username
          )
        : changes(
            db,
            "UPDATE users SET is_active = 0, updated_at = datetime('now') WHERE username = ?",
            op.username
          )
    case 'setRole':
      return setRole(db, op)
    case 'resetPassword':
      return changes(
        db,
        `UPDATE users SET password_hash = ?, must_change_password = 1,
         failed_login_count = 0, locked_until = NULL,
         password_changed_at = datetime('now'), updated_at = datetime('now')
         WHERE username = ?`,
        op.passwordHash,
        op.username
      )
    case 'changePassword':
      return changes(
        db,
        `UPDATE users SET password_hash = ?, must_change_password = 0,
         password_changed_at = datetime('now'), updated_at = datetime('now')
         WHERE username = ?`,
        op.passwordHash,
        op.username
      )
  }
}
