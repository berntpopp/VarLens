/**
 * Auth IPC handler integration tests
 *
 * Tests auth handlers via registerAuthHandlers with a real SQLite backend
 * and mock ipcMain.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DatabaseService } from '../../../src/main/database/DatabaseService'

// Mock MainLogger to avoid side effects
vi.mock('../../../src/main/services/MainLogger', () => ({
  mainLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

describe('auth IPC handlers', () => {
  let db: DatabaseService
  const mockHandle = vi.fn()
  const mockIpcMain = { handle: mockHandle }

  /** Look up a registered handler by channel name and invoke it */
  const invokeHandler = async (channel: string, ...args: unknown[]): Promise<unknown> => {
    const registration = mockHandle.mock.calls.find(
      (call: [string, ...unknown[]]) => call[0] === channel
    )
    if (!registration) throw new Error(`No handler registered for channel: ${channel}`)
    const handler = registration[1] as (event: unknown, ...args: unknown[]) => Promise<unknown>
    return handler({}, ...args)
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    db = new DatabaseService(':memory:')

    const { registerAuthHandlers } = await import('../../../src/main/ipc/handlers/auth')
    registerAuthHandlers({
      ipcMain: mockIpcMain as never,
      getDb: () => db,
      getDbManager: () => null as never
    })
  })

  afterEach(() => {
    db.close()
  })

  describe('auth:isAccountsEnabled', () => {
    it('returns false when no users exist', async () => {
      const result = await invokeHandler('auth:isAccountsEnabled')
      expect(result).toBe(false)
    })

    it('returns true after creating a first user (enabling accounts)', async () => {
      await db.auth.createFirstUser('admin', 'Admin User', 'password123')

      const result = await invokeHandler('auth:isAccountsEnabled')
      expect(result).toBe(true)
    })
  })

  describe('auth:login', () => {
    beforeEach(async () => {
      await db.auth.createFirstUser('admin', 'Admin User', 'password123')
    })

    it('succeeds with correct credentials', async () => {
      const result = (await invokeHandler('auth:login', 'admin', 'password123')) as {
        success: boolean
        user: { username: string; role: string } | null
      }

      expect(result.success).toBe(true)
      expect(result.user).not.toBeNull()
      expect(result.user!.username).toBe('admin')
      expect(result.user!.role).toBe('admin')
    })

    it('fails with wrong password', async () => {
      const result = (await invokeHandler('auth:login', 'admin', 'wrongpassword')) as {
        success: boolean
        user: null
      }

      expect(result.success).toBe(false)
      expect(result.user).toBeNull()
    })
  })

  describe('auth:currentUser', () => {
    it('returns null when not logged in', async () => {
      const result = await invokeHandler('auth:currentUser')
      expect(result).toBeNull()
    })

    it('returns user after login', async () => {
      await db.auth.createFirstUser('admin', 'Admin User', 'password123')
      await invokeHandler('auth:login', 'admin', 'password123')

      const result = (await invokeHandler('auth:currentUser')) as {
        id: number
        username: string
        role: string
      }

      expect(result).not.toBeNull()
      expect(result.username).toBe('admin')
      expect(result.role).toBe('admin')
    })
  })

  describe('auth:createUser', () => {
    beforeEach(async () => {
      // Create admin and log in
      await db.auth.createFirstUser('admin', 'Admin User', 'password123')
      await invokeHandler('auth:login', 'admin', 'password123')
    })

    it('creates a user successfully', async () => {
      const result = (await invokeHandler(
        'auth:createUser',
        'newuser',
        'New User',
        'temppass123'
      )) as {
        id: number
        username: string
        role: string
        must_change_password: number
      }

      expect(result.id).toBeGreaterThan(0)
      expect(result.username).toBe('newuser')
      expect(result.role).toBe('user')
      expect(result.must_change_password).toBe(1)
    })
  })

  describe('auth:listUsers', () => {
    it('lists created users', async () => {
      await db.auth.createFirstUser('admin', 'Admin User', 'password123')
      await invokeHandler('auth:login', 'admin', 'password123')
      await invokeHandler('auth:createUser', 'user1', 'User One', 'temppass1')
      await invokeHandler('auth:createUser', 'user2', 'User Two', 'temppass2')

      const result = (await invokeHandler('auth:listUsers')) as Array<{
        username: string
        role: string
      }>

      expect(result.length).toBe(3) // admin + 2 users
      const usernames = result.map((u) => u.username)
      expect(usernames).toContain('admin')
      expect(usernames).toContain('user1')
      expect(usernames).toContain('user2')
    })
  })

  describe('auth:logout', () => {
    it('clears current user', async () => {
      await db.auth.createFirstUser('admin', 'Admin User', 'password123')
      await invokeHandler('auth:login', 'admin', 'password123')

      // Verify logged in
      const before = await invokeHandler('auth:currentUser')
      expect(before).not.toBeNull()

      await invokeHandler('auth:logout')

      const after = await invokeHandler('auth:currentUser')
      expect(after).toBeNull()
    })
  })
})
