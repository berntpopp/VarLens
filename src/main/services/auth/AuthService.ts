/**
 * AuthService - Per-database user authentication with Argon2id
 *
 * Manages user accounts, password hashing, and authentication for
 * databases that have accounts enabled.
 */

import { nanoid } from 'nanoid'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'

import {
  defaultPasswordProvider,
  type PasswordProvider
} from '../../auth/providers/argon2-provider'
import {
  LOCKOUT_DURATION_MINUTES,
  MAX_FAILED_ATTEMPTS,
  ROLE_ADMIN,
  ROLE_USER,
  type UserRole
} from '../../../shared/auth/auth-constants'
import type { AuthResult, User } from '../../../shared/auth/types'
import { applyAuthWrite, type AuthWriteOp, type AuthWriteResult } from './auth-writes'

/** Executes an auth write; the desktop session routes it to the writer thread. */
export type AuthWriter = (op: AuthWriteOp) => Promise<AuthWriteResult>

export class AuthService {
  private readonly passwordProvider: PasswordProvider
  private writer: AuthWriter

  constructor(
    private db: DatabaseType,
    passwordProvider: PasswordProvider = defaultPasswordProvider
  ) {
    this.passwordProvider = passwordProvider
    this.writer = async (op) => applyAuthWrite(this.db, op)
  }

  /**
   * Route every auth write through `writer` (the SQLite session points it at
   * the single writer thread). Reads keep using this connection.
   */
  setWriter(writer: AuthWriter): void {
    this.writer = writer
  }

  async createFirstUser(
    username: string,
    displayName: string,
    password: string
  ): Promise<{ id: number; username: string; role: UserRole; recoveryKey: string }> {
    // Check no admin exists
    const existing = this.db
      .prepare('SELECT id FROM users WHERE role = ? LIMIT 1')
      .get(ROLE_ADMIN) as { id: number } | undefined

    if (existing) throw new Error('Admin user already exists')

    const passwordHash = await this.passwordProvider.hashPassword(password)
    const recoveryKey = nanoid(32)
    const recoveryKeyHash = await this.passwordProvider.hashPassword(recoveryKey)

    const result = (await this.writer({
      op: 'createFirstUser',
      username,
      displayName,
      passwordHash,
      recoveryKeyHash
    })) as { id: number }

    return {
      id: result.id,
      username,
      role: ROLE_ADMIN,
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

    const valid = await this.passwordProvider.verifyPassword(user.password_hash, password)

    if (!valid) {
      const newCount = user.failed_login_count + 1
      const lockedUntil =
        newCount >= MAX_FAILED_ATTEMPTS
          ? new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000).toISOString()
          : null
      await this.writer({ op: 'recordFailedLogin', userId: user.id, count: newCount, lockedUntil })
      return { success: false, user: null }
    }

    // Reset failed count on success
    await this.writer({ op: 'clearFailedLogins', userId: user.id })

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
  ): Promise<{ id: number; username: string; role: UserRole; must_change_password: number }> {
    const passwordHash = await this.passwordProvider.hashPassword(tempPassword)
    const result = (await this.writer({
      op: 'createUser',
      username,
      displayName,
      passwordHash,
      creatorUsername: createdByUsername
    })) as { id: number }

    return {
      id: result.id,
      username,
      role: ROLE_USER,
      must_change_password: 1
    }
  }

  getUser(username: string): User | undefined {
    return this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
      User | undefined
  }

  listUsers(): Omit<User, 'password_hash'>[] {
    const users = this.db.prepare('SELECT * FROM users ORDER BY created_at').all() as User[]

    return users.map(({ password_hash: _hash, ...u }) => u)
  }

  async deactivateUser(username: string): Promise<void> {
    const result = (await this.writer({ op: 'setActive', username, active: false })) as {
      changes: number
    }
    if (result.changes === 0) throw new Error(`User not found: ${username}`)
  }

  async reactivateUser(username: string): Promise<void> {
    const result = (await this.writer({ op: 'setActive', username, active: true })) as {
      changes: number
    }
    if (result.changes === 0) throw new Error(`User not found: ${username}`)
  }

  /** Change a user's role; never demotes the last active admin. */
  async setRole(username: string, role: UserRole): Promise<void> {
    await this.writer({ op: 'setRole', username, role })
  }

  async resetPassword(username: string, newPassword: string): Promise<void> {
    const passwordHash = await this.passwordProvider.hashPassword(newPassword)
    await this.writer({ op: 'resetPassword', username, passwordHash })
  }

  async changePassword(
    username: string,
    oldPassword: string,
    newPassword: string
  ): Promise<boolean> {
    const user = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
      User | undefined

    if (!user) return false

    const valid = await this.passwordProvider.verifyPassword(user.password_hash, oldPassword)
    if (!valid) return false

    const passwordHash = await this.passwordProvider.hashPassword(newPassword)
    await this.writer({ op: 'changePassword', username, passwordHash })

    return true
  }

  isAccountsEnabled(): boolean {
    const setting = this.db
      .prepare("SELECT value FROM database_settings WHERE key = 'accounts_enabled'")
      .get() as { value: string } | undefined
    return setting?.value === 'true'
  }
}
