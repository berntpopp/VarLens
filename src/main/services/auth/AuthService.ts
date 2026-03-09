/**
 * AuthService - Per-database user authentication with Argon2id
 *
 * Manages user accounts, password hashing, and authentication for
 * databases that have accounts enabled.
 */

import { hash, verify } from '@node-rs/argon2'
import { nanoid } from 'nanoid'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'

const ARGON2_OPTIONS = {
  memoryCost: 65536, // 64 MB
  timeCost: 3,
  parallelism: 4
}

/** Max failed login attempts before lockout */
const MAX_FAILED_ATTEMPTS = 5

/** Lockout duration in minutes */
const LOCKOUT_DURATION_MINUTES = 15

interface User {
  id: number
  username: string
  display_name: string | null
  password_hash: string
  role: string
  is_active: number
  must_change_password: number
  failed_login_count: number
  locked_until: string | null
  password_changed_at: string | null
  created_at: string
  created_by: number | null
  updated_at: string | null
}

interface AuthResult {
  success: boolean
  user: Omit<User, 'password_hash'> | null
  locked?: boolean
  mustChangePassword?: boolean
}

export class AuthService {
  constructor(private db: DatabaseType) {}

  async createFirstUser(
    username: string,
    displayName: string,
    password: string
  ): Promise<{ id: number; username: string; role: string; recoveryKey: string }> {
    // Check no admin exists
    const existing = this.db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get() as
      | { id: number }
      | undefined

    if (existing) throw new Error('Admin user already exists')

    const passwordHash = await hash(password, ARGON2_OPTIONS)
    const recoveryKey = nanoid(32)
    const recoveryKeyHash = await hash(recoveryKey, ARGON2_OPTIONS)

    // Store recovery key hash
    this.db
      .prepare('INSERT INTO database_settings (key, value) VALUES (?, ?)')
      .run('recovery_key_hash', recoveryKeyHash)

    // Enable accounts
    this.db
      .prepare(
        "INSERT OR REPLACE INTO database_settings (key, value) VALUES ('accounts_enabled', 'true')"
      )
      .run()

    const result = this.db
      .prepare(
        `INSERT INTO users (username, display_name, password_hash, role, password_changed_at)
         VALUES (?, ?, ?, 'admin', datetime('now'))`
      )
      .run(username, displayName, passwordHash)

    return {
      id: Number(result.lastInsertRowid),
      username,
      role: 'admin',
      recoveryKey
    }
  }

  async authenticate(username: string, password: string): Promise<AuthResult> {
    const user = this.db
      .prepare('SELECT * FROM users WHERE username = ? AND is_active = 1')
      .get(username) as User | undefined

    if (!user) return { success: false, user: null }

    // Check lockout
    if (
      user.locked_until !== null &&
      user.locked_until !== '' &&
      new Date(user.locked_until) > new Date()
    ) {
      return { success: false, user: null, locked: true }
    }

    const valid = await verify(user.password_hash, password)

    if (!valid) {
      const newCount = user.failed_login_count + 1
      if (newCount >= MAX_FAILED_ATTEMPTS) {
        const lockUntil = new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000).toISOString()
        this.db
          .prepare('UPDATE users SET failed_login_count = ?, locked_until = ? WHERE id = ?')
          .run(newCount, lockUntil, user.id)
      } else {
        this.db
          .prepare('UPDATE users SET failed_login_count = ? WHERE id = ?')
          .run(newCount, user.id)
      }
      return { success: false, user: null }
    }

    // Reset failed count on success
    this.db
      .prepare('UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = ?')
      .run(user.id)

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password_hash: _hash, ...safeUser } = user
    return {
      success: true,
      user: safeUser,
      mustChangePassword: user.must_change_password === 1
    }
  }

  async createUser(
    username: string,
    displayName: string,
    tempPassword: string,
    createdByUsername: string
  ): Promise<{ id: number; username: string; role: string; must_change_password: number }> {
    const creator = this.getUser(createdByUsername)
    const passwordHash = await hash(tempPassword, ARGON2_OPTIONS)

    const result = this.db
      .prepare(
        `INSERT INTO users (username, display_name, password_hash, role, must_change_password, created_by, password_changed_at)
         VALUES (?, ?, ?, 'user', 1, ?, datetime('now'))`
      )
      .run(username, displayName, passwordHash, creator?.id ?? null)

    return {
      id: Number(result.lastInsertRowid),
      username,
      role: 'user',
      must_change_password: 1
    }
  }

  getUser(username: string): User | undefined {
    return this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
      | User
      | undefined
  }

  listUsers(): Omit<User, 'password_hash'>[] {
    const users = this.db.prepare('SELECT * FROM users ORDER BY created_at').all() as User[]

    return users.map(({ password_hash: _hash, ...u }) => u)
  }

  async deactivateUser(username: string): Promise<void> {
    const result = this.db
      .prepare("UPDATE users SET is_active = 0, updated_at = datetime('now') WHERE username = ?")
      .run(username)
    if (result.changes === 0) {
      throw new Error(`User not found: ${username}`)
    }
  }

  async resetPassword(username: string, newPassword: string): Promise<void> {
    const passwordHash = await hash(newPassword, ARGON2_OPTIONS)
    this.db
      .prepare(
        `UPDATE users SET password_hash = ?, must_change_password = 1,
         failed_login_count = 0, locked_until = NULL,
         password_changed_at = datetime('now'), updated_at = datetime('now')
         WHERE username = ?`
      )
      .run(passwordHash, username)
  }

  async changePassword(
    username: string,
    oldPassword: string,
    newPassword: string
  ): Promise<boolean> {
    const user = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
      | User
      | undefined

    if (!user) return false

    const valid = await verify(user.password_hash, oldPassword)
    if (!valid) return false

    const passwordHash = await hash(newPassword, ARGON2_OPTIONS)
    this.db
      .prepare(
        `UPDATE users SET password_hash = ?, must_change_password = 0,
         password_changed_at = datetime('now'), updated_at = datetime('now')
         WHERE username = ?`
      )
      .run(passwordHash, username)

    return true
  }

  isAccountsEnabled(): boolean {
    const setting = this.db
      .prepare("SELECT value FROM database_settings WHERE key = 'accounts_enabled'")
      .get() as { value: string } | undefined
    return setting?.value === 'true'
  }
}
