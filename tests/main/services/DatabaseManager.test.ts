/**
 * Tests for DatabaseManager - lifecycle, switching, rollback, and error handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { unlinkSync, existsSync, writeFileSync } from 'fs'
import { DatabaseManager } from '../../../src/main/services/DatabaseManager'
import { RecentDatabasesService } from '../../../src/main/services/RecentDatabasesService'
import { DatabaseError } from '../../../src/main/database/errors'

// Helper to create a unique temp file path
function tempDbPath(suffix = ''): string {
  return join(
    tmpdir(),
    `varlens-test-dbmgr-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}.db`
  )
}

// Helper to clean up temp files including WAL/SHM
function cleanupDb(dbPath: string): void {
  for (const ext of ['', '-wal', '-shm']) {
    const p = dbPath + ext
    if (existsSync(p)) {
      try {
        unlinkSync(p)
      } catch {
        // Best effort
      }
    }
  }
}

describe('DatabaseManager', () => {
  let settingsPath: string
  let recentService: RecentDatabasesService
  let manager: DatabaseManager

  beforeEach(() => {
    settingsPath = join(
      tmpdir(),
      `varlens-test-settings-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    )
    recentService = new RecentDatabasesService(settingsPath)
    manager = new DatabaseManager(recentService)
  })

  afterEach(async () => {
    await manager.close()
    if (existsSync(settingsPath)) {
      try {
        unlinkSync(settingsPath)
      } catch {
        // Best effort
      }
    }
  })

  describe('open()', () => {
    it('opens a new database file', async () => {
      const dbPath = tempDbPath()
      try {
        await manager.open(dbPath)
        expect(manager.getCurrentPath()).toBe(dbPath)
        expect(manager.getCurrent()).toBeDefined()
        expect(manager.getCurrentInfo()).toEqual({
          path: dbPath,
          name: expect.stringContaining('.db'),
          encrypted: false
        })
      } finally {
        await manager.close()
        cleanupDb(dbPath)
      }
    })

    it('closes previous database when opening a new one', async () => {
      const db1 = tempDbPath('-1')
      const db2 = tempDbPath('-2')
      try {
        await manager.open(db1)
        expect(manager.getCurrentPath()).toBe(db1)

        await manager.open(db2)
        expect(manager.getCurrentPath()).toBe(db2)
      } finally {
        await manager.close()
        cleanupDb(db1)
        cleanupDb(db2)
      }
    })

    it('adds to recent databases list', async () => {
      const dbPath = tempDbPath()
      try {
        await manager.open(dbPath)
        const recent = manager.getRecentDatabases()
        expect(recent).toHaveLength(1)
        expect(recent[0].path).toBe(dbPath)
      } finally {
        await manager.close()
        cleanupDb(dbPath)
      }
    })

    it('throws DatabaseError for invalid path', async () => {
      await expect(
        manager.open('/nonexistent/directory/that/does/not/exist/test.db')
      ).rejects.toThrow(DatabaseError)
    })

    it('throws DatabaseError when trying to open a non-database file', async () => {
      const fakePath = tempDbPath('-fake')
      writeFileSync(fakePath, 'this is not a database')
      try {
        await expect(manager.open(fakePath)).rejects.toThrow(DatabaseError)
      } finally {
        cleanupDb(fakePath)
      }
    })
  })

  describe('createDatabase()', () => {
    it('creates a new database file', async () => {
      const dbPath = tempDbPath()
      try {
        await manager.createDatabase(dbPath)
        expect(existsSync(dbPath)).toBe(true)
        expect(manager.getCurrentPath()).toBe(dbPath)
        expect(manager.getCurrent()).toBeDefined()
      } finally {
        await manager.close()
        cleanupDb(dbPath)
      }
    })

    it('closes previous database before creating new one', async () => {
      const db1 = tempDbPath('-1')
      const db2 = tempDbPath('-2')
      try {
        await manager.open(db1)
        expect(manager.getCurrentPath()).toBe(db1)

        await manager.createDatabase(db2)
        expect(manager.getCurrentPath()).toBe(db2)
      } finally {
        await manager.close()
        cleanupDb(db1)
        cleanupDb(db2)
      }
    })

    it('adds to recent databases list', async () => {
      const dbPath = tempDbPath()
      try {
        await manager.createDatabase(dbPath)
        const recent = manager.getRecentDatabases()
        expect(recent).toHaveLength(1)
        expect(recent[0].path).toBe(dbPath)
      } finally {
        await manager.close()
        cleanupDb(dbPath)
      }
    })

    it('throws DatabaseError for invalid path', async () => {
      await expect(
        manager.createDatabase('/nonexistent/directory/that/does/not/exist/test.db')
      ).rejects.toThrow(DatabaseError)
    })
  })

  describe('switchDatabase()', () => {
    it('switches from one database to another', async () => {
      const db1 = tempDbPath('-1')
      const db2 = tempDbPath('-2')
      try {
        await manager.open(db1)
        expect(manager.getCurrentPath()).toBe(db1)

        await manager.createDatabase(db2)
        await manager.close()

        await manager.open(db1)
        await manager.switchDatabase(db2)
        expect(manager.getCurrentPath()).toBe(db2)
      } finally {
        await manager.close()
        cleanupDb(db1)
        cleanupDb(db2)
      }
    })

    it('rolls back to previous database on failure', async () => {
      const db1 = tempDbPath('-1')
      try {
        await manager.open(db1)
        expect(manager.getCurrentPath()).toBe(db1)

        await expect(
          manager.switchDatabase('/nonexistent/directory/that/does/not/exist/bad.db')
        ).rejects.toThrow(DatabaseError)

        expect(manager.getCurrentPath()).toBe(db1)
        expect(manager.getCurrent()).toBeDefined()
        const result = manager.getCurrent().database.prepare('SELECT 1 as test').get() as {
          test: number
        }
        expect(result.test).toBe(1)
      } finally {
        await manager.close()
        cleanupDb(db1)
      }
    })

    it('rolls back to previous database when opening corrupted file', async () => {
      const db1 = tempDbPath('-1')
      const badDb = tempDbPath('-bad')
      writeFileSync(badDb, 'this is not a database file')
      try {
        await manager.open(db1)
        expect(manager.getCurrentPath()).toBe(db1)

        await expect(manager.switchDatabase(badDb)).rejects.toThrow(DatabaseError)

        expect(manager.getCurrentPath()).toBe(db1)
        expect(manager.getCurrent()).toBeDefined()
      } finally {
        await manager.close()
        cleanupDb(db1)
        cleanupDb(badDb)
      }
    })

    it('works when switching from no database (null state)', async () => {
      const dbPath = tempDbPath()
      try {
        expect(manager.getCurrentPath()).toBeNull()

        await manager.switchDatabase(dbPath)
        expect(manager.getCurrentPath()).toBe(dbPath)
      } finally {
        await manager.close()
        cleanupDb(dbPath)
      }
    })

    it('restores null state on failure when no previous database', async () => {
      expect(manager.getCurrentPath()).toBeNull()

      await expect(manager.switchDatabase('/nonexistent/directory/bad.db')).rejects.toThrow(
        DatabaseError
      )

      expect(manager.getCurrentPath()).toBeNull()
    })

    it('updates recent databases list on successful switch', async () => {
      const db1 = tempDbPath('-1')
      const db2 = tempDbPath('-2')
      try {
        await manager.open(db1)
        await manager.switchDatabase(db2)
        const recent = manager.getRecentDatabases()
        expect(recent.length).toBeGreaterThanOrEqual(2)
        expect(recent[0].path).toBe(db2)
      } finally {
        await manager.close()
        cleanupDb(db1)
        cleanupDb(db2)
      }
    })

    it('does not update recent databases on failed switch', async () => {
      const db1 = tempDbPath('-1')
      try {
        await manager.open(db1)
        const recentBefore = manager.getRecentDatabases()

        await expect(manager.switchDatabase('/nonexistent/bad.db')).rejects.toThrow(DatabaseError)

        const recentAfter = manager.getRecentDatabases()
        expect(recentAfter).toEqual(recentBefore)
      } finally {
        await manager.close()
        cleanupDb(db1)
      }
    })
  })

  describe('openDetectEncryption()', () => {
    it('detects plaintext database', async () => {
      const dbPath = tempDbPath()
      try {
        await manager.createDatabase(dbPath)
        await manager.close()

        const result = manager.openDetectEncryption(dbPath)
        expect(result.needsPassword).toBe(false)
      } finally {
        cleanupDb(dbPath)
      }
    })

    it('throws DatabaseError for non-existent file', () => {
      expect(() => {
        manager.openDetectEncryption('/nonexistent/bad.db')
      }).toThrow(DatabaseError)
    })

    it('throws DatabaseError for corrupted file', () => {
      const badPath = tempDbPath('-bad')
      writeFileSync(badPath, 'not a database')
      try {
        expect(() => {
          manager.openDetectEncryption(badPath)
        }).toThrow(DatabaseError)
      } finally {
        cleanupDb(badPath)
      }
    })
  })

  describe('close()', () => {
    it('safely closes when no database is open', async () => {
      await manager.close()
      expect(manager.getCurrentPath()).toBeNull()
    })

    it('clears state after closing', async () => {
      const dbPath = tempDbPath()
      try {
        await manager.open(dbPath)
        expect(manager.getCurrentPath()).toBe(dbPath)

        await manager.close()
        expect(manager.getCurrentPath()).toBeNull()
        expect(manager.getCurrentInfo()).toBeNull()
      } finally {
        cleanupDb(dbPath)
      }
    })

    it('can be called multiple times safely', async () => {
      const dbPath = tempDbPath()
      try {
        await manager.open(dbPath)
        await manager.close()
        await manager.close()
        expect(manager.getCurrentPath()).toBeNull()
      } finally {
        cleanupDb(dbPath)
      }
    })
  })

  describe('getCurrent()', () => {
    it('throws DatabaseError when no database is open', () => {
      expect(() => {
        manager.getCurrent()
      }).toThrow(DatabaseError)
    })

    it('returns current database service', async () => {
      const dbPath = tempDbPath()
      try {
        await manager.open(dbPath)
        const current = manager.getCurrent()
        expect(current).toBeDefined()
        expect(current.getPath()).toBe(dbPath)
      } finally {
        await manager.close()
        cleanupDb(dbPath)
      }
    })
  })

  describe('getCurrentInfo()', () => {
    it('returns null when no database is open', () => {
      expect(manager.getCurrentInfo()).toBeNull()
    })

    it('returns info for plaintext database', async () => {
      const dbPath = tempDbPath()
      try {
        await manager.open(dbPath)
        const info = manager.getCurrentInfo()
        expect(info).toEqual({
          path: dbPath,
          name: expect.any(String),
          encrypted: false
        })
      } finally {
        await manager.close()
        cleanupDb(dbPath)
      }
    })
  })

  describe('multiple operations sequence', () => {
    it('handles open → switch → switch → close correctly', async () => {
      const db1 = tempDbPath('-1')
      const db2 = tempDbPath('-2')
      const db3 = tempDbPath('-3')
      try {
        await manager.open(db1)
        expect(manager.getCurrentPath()).toBe(db1)

        await manager.switchDatabase(db2)
        expect(manager.getCurrentPath()).toBe(db2)

        await manager.switchDatabase(db3)
        expect(manager.getCurrentPath()).toBe(db3)

        await manager.close()
        expect(manager.getCurrentPath()).toBeNull()
      } finally {
        cleanupDb(db1)
        cleanupDb(db2)
        cleanupDb(db3)
      }
    })

    it('handles open → failed switch → successful switch correctly', async () => {
      const db1 = tempDbPath('-1')
      const db2 = tempDbPath('-2')
      try {
        await manager.open(db1)

        await expect(manager.switchDatabase('/nonexistent/bad.db')).rejects.toThrow(DatabaseError)
        expect(manager.getCurrentPath()).toBe(db1)

        await manager.switchDatabase(db2)
        expect(manager.getCurrentPath()).toBe(db2)
      } finally {
        await manager.close()
        cleanupDb(db1)
        cleanupDb(db2)
      }
    })
  })

  describe('removeRecentDatabase()', () => {
    it('removes a database from the recent list', async () => {
      const db1 = tempDbPath('-1')
      const db2 = tempDbPath('-2')
      try {
        await manager.open(db1)
        await manager.switchDatabase(db2)
        expect(manager.getRecentDatabases()).toHaveLength(2)

        manager.removeRecentDatabase(db1)
        const recent = manager.getRecentDatabases()
        expect(recent).toHaveLength(1)
        expect(recent[0].path).toBe(db2)
      } finally {
        await manager.close()
        cleanupDb(db1)
        cleanupDb(db2)
      }
    })

    it('does nothing when removing non-existent path', async () => {
      const dbPath = tempDbPath()
      try {
        await manager.open(dbPath)
        expect(manager.getRecentDatabases()).toHaveLength(1)

        manager.removeRecentDatabase('/nonexistent/fake.db')
        expect(manager.getRecentDatabases()).toHaveLength(1)
      } finally {
        await manager.close()
        cleanupDb(dbPath)
      }
    })
  })
})
