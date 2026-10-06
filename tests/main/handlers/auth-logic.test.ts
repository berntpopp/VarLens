/**
 * Auth logic unit tests
 *
 * Tests the extracted auth-logic module directly with a real in-memory SQLite backend.
 * Focuses on admin checks, login/logout state, and password handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DatabaseService } from '../../../src/main/database/DatabaseService'
import * as authLogic from '../../../src/main/ipc/handlers/auth-logic'

// Mock MainLogger to avoid side effects
vi.mock('../../../src/main/services/MainLogger', () => ({
  mainLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

describe('auth-logic', () => {
  let db: DatabaseService
  let getDb: () => DatabaseService

  beforeEach(async () => {
    db = new DatabaseService(':memory:')
    getDb = () => db
  })

  afterEach(() => {
    db.close()
  })

  describe('isAccountsEnabled', () => {
    it('returns false when no users exist', () => {
      const result = authLogic.isAccountsEnabled(getDb)
      expect(result).toBe(false)
    })

    it('returns true after creating first user', async () => {
      await db.auth.createFirstUser('admin', 'Admin User', 'password123')
      const result = authLogic.isAccountsEnabled(getDb)
      expect(result).toBe(true)
    })
  })

  describe('login', () => {
    beforeEach(async () => {
      await db.auth.createFirstUser('admin', 'Admin User', 'password123')
    })

    it('succeeds with correct credentials and sets current user', async () => {
      const result = (await authLogic.login('admin', 'password123', getDb)) as {
        success: boolean
        user: { username: string; role: string } | null
      }

      expect(result.success).toBe(true)
      expect(result.user).not.toBeNull()
      expect(result.user!.username).toBe('admin')

      // Verify current user was set
      const currentUser = authLogic.getCurrentUser(getDb)
      expect(currentUser).not.toBeNull()
    })

    it('fails with wrong password and does not set current user', async () => {
      const result = (await authLogic.login('admin', 'wrongpass', getDb)) as {
        success: boolean
        user: null
      }

      expect(result.success).toBe(false)
      expect(result.user).toBeNull()

      const currentUser = authLogic.getCurrentUser(getDb)
      expect(currentUser).toBeNull()
    })
  })

  describe('logout', () => {
    it('clears the current user', async () => {
      await db.auth.createFirstUser('admin', 'Admin User', 'password123')
      await authLogic.login('admin', 'password123', getDb)

      authLogic.logout(getDb)

      const currentUser = authLogic.getCurrentUser(getDb)
      expect(currentUser).toBeNull()
    })
  })

  describe('getCurrentUser', () => {
    it('returns null when not logged in', () => {
      const result = authLogic.getCurrentUser(getDb)
      expect(result).toBeNull()
    })
  })

  describe('createUser (admin check)', () => {
    it('throws when not authenticated', async () => {
      await expect(authLogic.createUser('newuser', 'New User', 'temp123', getDb)).rejects.toThrow(
        'Only admins can create users'
      )
    })

    it('throws when authenticated as non-admin', async () => {
      await db.auth.createFirstUser('admin', 'Admin User', 'password123')
      await authLogic.login('admin', 'password123', getDb)
      await authLogic.createUser('regularuser', 'Regular User', 'temp123', getDb)
      authLogic.logout(getDb)
      await authLogic.login('regularuser', 'temp123', getDb)

      await expect(authLogic.createUser('another', 'Another', 'temp456', getDb)).rejects.toThrow(
        'Only admins can create users'
      )
    })

    it('succeeds when authenticated as admin', async () => {
      await db.auth.createFirstUser('admin', 'Admin User', 'password123')
      await authLogic.login('admin', 'password123', getDb)

      const result = (await authLogic.createUser('newuser', 'New User', 'temp123', getDb)) as {
        username: string
        role: string
      }
      expect(result.username).toBe('newuser')
      expect(result.role).toBe('viewer')
    })
  })

  describe('listUsers (admin check)', () => {
    it('throws when not authenticated', () => {
      expect(() => authLogic.listUsers(getDb)).toThrow('Only admins can list users')
    })

    it('returns users when admin', async () => {
      await db.auth.createFirstUser('admin', 'Admin User', 'password123')
      await authLogic.login('admin', 'password123', getDb)

      const users = authLogic.listUsers(getDb) as Array<{ username: string }>
      expect(users.length).toBe(1)
      expect(users[0].username).toBe('admin')
    })
  })

  describe('deactivateUser', () => {
    it('throws when not admin', async () => {
      await expect(authLogic.deactivateUser('someone', getDb)).rejects.toThrow(
        'Only admins can deactivate users'
      )
    })

    it('throws when trying to deactivate self', async () => {
      await db.auth.createFirstUser('admin', 'Admin User', 'password123')
      await authLogic.login('admin', 'password123', getDb)

      await expect(authLogic.deactivateUser('admin', getDb)).rejects.toThrow(
        'Cannot deactivate yourself'
      )
    })
  })

  describe('resetPassword (admin check)', () => {
    it('throws when not admin', async () => {
      await expect(authLogic.resetPassword('someone', 'newpass', getDb)).rejects.toThrow(
        'Only admins can reset passwords'
      )
    })
  })

  describe('changePassword', () => {
    it('throws when not authenticated', async () => {
      await expect(authLogic.changePassword('old', 'new', getDb)).rejects.toThrow(
        'Not authenticated'
      )
    })

    it('throws with wrong current password', async () => {
      await db.auth.createFirstUser('admin', 'Admin User', 'password123')
      await authLogic.login('admin', 'password123', getDb)

      await expect(authLogic.changePassword('wrongold', 'newpass', getDb)).rejects.toThrow(
        'Invalid current password'
      )
    })

    it('succeeds with correct current password', async () => {
      await db.auth.createFirstUser('admin', 'Admin User', 'password123')
      await authLogic.login('admin', 'password123', getDb)

      await expect(
        authLogic.changePassword('password123', 'newpass456', getDb)
      ).resolves.not.toThrow()
    })
  })
})
