import Database from 'better-sqlite3-multiple-ciphers'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { AuthService } from '../../../src/main/services/auth'

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
    db.prepare(
      "INSERT INTO database_settings (key, value) VALUES ('accounts_enabled', 'true')"
    ).run()
    const result = db
      .prepare("SELECT value FROM database_settings WHERE key = 'accounts_enabled'")
      .get() as { value: string }
    expect(result.value).toBe('true')
  })
})

describe('AuthService', () => {
  let db: Database.Database
  let authService: AuthService

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
    authService = new AuthService(db)
  })

  afterEach(() => {
    db.close()
  })

  describe('account setup', () => {
    it('should create first user as admin', async () => {
      const result = await authService.createFirstUser('admin1', 'Admin User', 'password123')
      expect(result.role).toBe('admin')
      expect(result.username).toBe('admin1')
    })

    it('should reject second call to createFirstUser', async () => {
      await authService.createFirstUser('admin1', 'Admin', 'pass')
      await expect(authService.createFirstUser('admin2', 'Admin2', 'pass')).rejects.toThrow(
        'Admin user already exists'
      )
    })

    it('should generate a recovery key', async () => {
      const { recoveryKey } = await authService.createFirstUser('admin1', 'Admin', 'pass')
      expect(recoveryKey).toBeDefined()
      expect(recoveryKey.length).toBeGreaterThan(10)
    })

    it('should enable accounts setting', async () => {
      await authService.createFirstUser('admin1', 'Admin', 'pass')
      expect(authService.isAccountsEnabled()).toBe(true)
    })
  })

  describe('authentication', () => {
    beforeEach(async () => {
      await authService.createFirstUser('admin1', 'Admin', 'correct-password')
    })

    it('should authenticate with correct password', async () => {
      const result = await authService.authenticate('admin1', 'correct-password')
      expect(result.success).toBe(true)
      expect(result.user?.username).toBe('admin1')
    })

    it('should reject wrong password', async () => {
      const result = await authService.authenticate('admin1', 'wrong-password')
      expect(result.success).toBe(false)
    })

    it('should reject non-existent user', async () => {
      const result = await authService.authenticate('nonexistent', 'password')
      expect(result.success).toBe(false)
    })

    it('should increment failed login count', async () => {
      await authService.authenticate('admin1', 'wrong')
      await authService.authenticate('admin1', 'wrong')
      const user = authService.getUser('admin1')
      expect(user?.failed_login_count).toBe(2)
    })

    it('should reset failed count on successful login', async () => {
      await authService.authenticate('admin1', 'wrong')
      await authService.authenticate('admin1', 'correct-password')
      const user = authService.getUser('admin1')
      expect(user?.failed_login_count).toBe(0)
    })

    it('should not expose password_hash in auth result', async () => {
      const result = await authService.authenticate('admin1', 'correct-password')
      expect(result.user).toBeDefined()
      expect((result.user as Record<string, unknown>).password_hash).toBeUndefined()
    })
  })

  describe('user management', () => {
    beforeEach(async () => {
      await authService.createFirstUser('admin1', 'Admin', 'pass')
    })

    it('should create regular user', async () => {
      const user = await authService.createUser('user1', 'User One', 'temppass', 'admin1')
      expect(user.role).toBe('user')
      expect(user.must_change_password).toBe(1)
    })

    it('should list users without password hashes', async () => {
      await authService.createUser('user1', 'User One', 'pass', 'admin1')
      const users = authService.listUsers()
      expect(users.length).toBe(2)
      for (const u of users) {
        expect((u as Record<string, unknown>).password_hash).toBeUndefined()
      }
    })

    it('should deactivate user', async () => {
      await authService.createUser('user1', 'User One', 'pass', 'admin1')
      await authService.deactivateUser('user1')
      const user = authService.getUser('user1')
      expect(user?.is_active).toBe(0)
    })

    it('should reject login for deactivated user', async () => {
      await authService.createUser('user1', 'User One', 'pass', 'admin1')
      await authService.deactivateUser('user1')
      const result = await authService.authenticate('user1', 'pass')
      expect(result.success).toBe(false)
    })

    it('should reset password', async () => {
      await authService.createUser('user1', 'User', 'oldpass', 'admin1')
      await authService.resetPassword('user1', 'newpass')
      const result = await authService.authenticate('user1', 'newpass')
      expect(result.success).toBe(true)
    })

    it('should change password with valid old password', async () => {
      await authService.createUser('user1', 'User', 'oldpass', 'admin1')
      const changed = await authService.changePassword('user1', 'oldpass', 'newpass')
      expect(changed).toBe(true)
      const result = await authService.authenticate('user1', 'newpass')
      expect(result.success).toBe(true)
    })

    it('should reject password change with wrong old password', async () => {
      await authService.createUser('user1', 'User', 'oldpass', 'admin1')
      const changed = await authService.changePassword('user1', 'wrongold', 'newpass')
      expect(changed).toBe(false)
    })
  })

  describe('auth edge cases', () => {
    beforeEach(async () => {
      await authService.createFirstUser('admin1', 'Admin', 'adminpass')
    })

    it('should handle deactivated user login', async () => {
      await authService.createUser('user1', 'User One', 'pass123', 'admin1')
      // Verify user can log in before deactivation
      const beforeResult = await authService.authenticate('user1', 'pass123')
      expect(beforeResult.success).toBe(true)

      await authService.deactivateUser('user1')

      // Verify user cannot log in after deactivation
      const afterResult = await authService.authenticate('user1', 'pass123')
      expect(afterResult.success).toBe(false)
      expect(afterResult.user).toBeNull()
    })

    it('should enforce must_change_password flag', async () => {
      const created = await authService.createUser('user1', 'User One', 'temppass', 'admin1')
      expect(created.must_change_password).toBe(1)

      // Verify the flag is also reflected in the database
      const user = authService.getUser('user1')
      expect(user?.must_change_password).toBe(1)

      // Verify the flag is returned in auth result
      const authResult = await authService.authenticate('user1', 'temppass')
      expect(authResult.success).toBe(true)
      expect(authResult.mustChangePassword).toBe(true)

      // After changing password, must_change_password should be cleared
      await authService.changePassword('user1', 'temppass', 'newpass')
      const updatedUser = authService.getUser('user1')
      expect(updatedUser?.must_change_password).toBe(0)

      const authAfterChange = await authService.authenticate('user1', 'newpass')
      expect(authAfterChange.mustChangePassword).toBe(false)
    })

    it('should list all users correctly', async () => {
      await authService.createUser('user1', 'User One', 'pass1', 'admin1')
      await authService.createUser('user2', 'User Two', 'pass2', 'admin1')
      await authService.createUser('user3', 'User Three', 'pass3', 'admin1')

      const users = authService.listUsers()
      expect(users).toHaveLength(4) // admin + 3 users
      const usernames = users.map((u) => u.username)
      expect(usernames).toContain('admin1')
      expect(usernames).toContain('user1')
      expect(usernames).toContain('user2')
      expect(usernames).toContain('user3')

      // Verify no password hashes are exposed
      for (const u of users) {
        expect((u as Record<string, unknown>).password_hash).toBeUndefined()
      }

      // Verify roles are correct
      const admin = users.find((u) => u.username === 'admin1')
      expect(admin?.role).toBe('admin')
      const regularUser = users.find((u) => u.username === 'user1')
      expect(regularUser?.role).toBe('user')
    })

    it('should handle changing password with wrong old password', async () => {
      await authService.createUser('user1', 'User One', 'realpass', 'admin1')

      const changed = await authService.changePassword('user1', 'wrongpass', 'newpass')
      expect(changed).toBe(false)

      // Verify old password still works
      const result = await authService.authenticate('user1', 'realpass')
      expect(result.success).toBe(true)

      // Verify the attempted new password does not work
      const badResult = await authService.authenticate('user1', 'newpass')
      expect(badResult.success).toBe(false)
    })

    it('should handle creating duplicate username', async () => {
      await authService.createUser('user1', 'User One', 'pass1', 'admin1')
      await expect(
        authService.createUser('user1', 'User One Again', 'pass2', 'admin1')
      ).rejects.toThrow(/UNIQUE constraint failed/)
    })

    it('should handle lockout recovery after lockout duration', async () => {
      await authService.createUser('user1', 'User One', 'pass123', 'admin1')

      // Trigger lockout with 5 failed attempts
      for (let i = 0; i < 5; i++) {
        await authService.authenticate('user1', 'wrongpass')
      }

      // Verify the user is locked
      const lockedUser = authService.getUser('user1')
      expect(lockedUser?.failed_login_count).toBe(5)
      expect(lockedUser?.locked_until).not.toBeNull()

      // Verify locked user cannot authenticate even with correct password
      const lockedResult = await authService.authenticate('user1', 'pass123')
      expect(lockedResult.success).toBe(false)

      // Simulate lockout expiration by setting locked_until to the past
      db.prepare(
        "UPDATE users SET locked_until = datetime('now', '-1 hour') WHERE username = ?"
      ).run('user1')

      // Verify user can now log in after lockout expires
      const recoveredResult = await authService.authenticate('user1', 'pass123')
      expect(recoveredResult.success).toBe(true)
      expect(recoveredResult.user?.username).toBe('user1')
    })

    it('should reset failed count on successful login', async () => {
      await authService.createUser('user1', 'User One', 'pass123', 'admin1')

      // Accumulate some failed attempts (but not enough to lock out)
      await authService.authenticate('user1', 'wrong1')
      await authService.authenticate('user1', 'wrong2')
      await authService.authenticate('user1', 'wrong3')

      const beforeUser = authService.getUser('user1')
      expect(beforeUser?.failed_login_count).toBe(3)

      // Successful login should reset the counter
      const result = await authService.authenticate('user1', 'pass123')
      expect(result.success).toBe(true)

      const afterUser = authService.getUser('user1')
      expect(afterUser?.failed_login_count).toBe(0)
      expect(afterUser?.locked_until).toBeNull()
    })

    it('should handle concurrent login attempts', async () => {
      await authService.createUser('user1', 'User One', 'pass123', 'admin1')

      // Fire two login attempts concurrently
      const [result1, result2] = await Promise.all([
        authService.authenticate('user1', 'pass123'),
        authService.authenticate('user1', 'pass123')
      ])

      // Both should succeed without errors
      expect(result1.success).toBe(true)
      expect(result2.success).toBe(true)
      expect(result1.user?.username).toBe('user1')
      expect(result2.user?.username).toBe('user1')

      // Failed count should remain at 0
      const user = authService.getUser('user1')
      expect(user?.failed_login_count).toBe(0)
    })
  })
})
