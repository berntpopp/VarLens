import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DatabaseManager } from '../../../src/main/services/DatabaseManager'
import { RecentDatabasesService } from '../../../src/main/services/RecentDatabasesService'
import { POSTGRES_CAPABILITIES } from '../../../src/main/storage/postgres/PostgresStorageSession'
import type { StorageSession } from '../../../src/main/storage/session'
import type { DbPool } from '../../../src/main/database/DbPool'

let tempDir: string | null = null

type SqlitePoolSession = StorageSession & { getDbPool(): DbPool | null }

function hasSqlitePool(session: StorageSession): session is SqlitePoolSession {
  return session.capabilities.backend === 'sqlite' && 'getDbPool' in session
}

afterEach(async () => {
  if (tempDir !== null) {
    rmSync(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

describe('DatabaseManager storage-session compatibility', () => {
  it('exposes the current storage session while preserving DatabaseService compatibility', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'varlens-storage-manager-'))
    const settingsPath = join(tempDir, 'settings.json')
    const dbPath = join(tempDir, 'test.db')
    const manager = new DatabaseManager(new RecentDatabasesService(settingsPath))

    await manager.open(dbPath)

    const session = manager.getCurrentSession()
    expect(session.workspace.kind).toBe('sqlite')
    expect(session.workspace.path).toBe(dbPath)

    const current = manager.getCurrent()
    expect(current.getPath()).toBe(dbPath)

    await manager.close()
  })

  it('creates sqlite sessions that own the legacy worker read pool', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'varlens-storage-manager-'))
    const settingsPath = join(tempDir, 'settings.json')
    const dbPath = join(tempDir, 'test.db')
    const manager = new DatabaseManager(new RecentDatabasesService(settingsPath))

    await manager.open(dbPath)

    const session = manager.getCurrentSession()
    expect(hasSqlitePool(session)).toBe(true)
    expect(hasSqlitePool(session) ? session.getDbPool() : null).not.toBeNull()

    await manager.close()
  })

  it('can adopt a postgres-backed current session without exposing a sqlite path', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'varlens-storage-manager-'))
    const settingsPath = join(tempDir, 'settings.json')
    const manager = new DatabaseManager(new RecentDatabasesService(settingsPath))

    const session = {
      workspace: {
        kind: 'postgres',
        connectionLabel: '127.0.0.1:55432/varlens_dev (public)',
        connectionUrlRedacted: 'postgres://127.0.0.1:55432/varlens_dev',
        schema: 'public'
      },
      capabilities: POSTGRES_CAPABILITIES,
      listCases: async () => [],
      getReadExecutor: () => ({
        execute: async () => {
          throw new Error('not implemented')
        }
      }),
      getWriteExecutor: () => ({
        execute: vi.fn()
      }),
      getImportExecutor: () => {
        throw new Error('Import executor is not available for this test session')
      },
      getEncryptionKey: () => {
        throw new Error('Encryption keys are not available for postgres sessions')
      },
      needsStartupRebuild: () => {
        throw new Error('Startup rebuild is not supported for postgres sessions')
      },
      rekey: () => {
        throw new Error('SQLite rekey is not supported for postgres sessions')
      },
      close: async () => undefined,
      health: async () => ({ ok: true, backend: 'postgres' as const })
    } satisfies StorageSession

    await manager.openPostgresSession(session)

    expect(manager.getCurrentSession()).toBe(session)
    expect(manager.getCurrentPath()).toBeNull()
    expect(manager.getCurrentInfo()).toEqual({
      path: 'postgres://127.0.0.1:55432/varlens_dev',
      name: 'PostgreSQL: 127.0.0.1:55432/varlens_dev (public)',
      encrypted: false,
      unencryptedMigratable: false
    })

    await manager.close()
  })

  it('rejects sqlite-backed sessions passed to openPostgresSession', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'varlens-storage-manager-'))
    const settingsPath = join(tempDir, 'settings.json')
    const dbPath = join(tempDir, 'test.db')
    const manager = new DatabaseManager(new RecentDatabasesService(settingsPath))

    await manager.open(dbPath)
    const sqliteSession = manager.getCurrentSession()

    await expect(manager.openPostgresSession(sqliteSession)).rejects.toThrow(
      'openPostgresSession requires a postgres-backed session'
    )

    expect(manager.getCurrentSession()).toBe(sqliteSession)

    await manager.close()
  })

  it('resolves the legacy db pool from the active sqlite session', async () => {
    vi.resetModules()

    const sessionPool = {
      run: vi.fn(),
      destroy: vi.fn()
    }
    const { getDbPool, setActiveSessionResolver } =
      await import('../../../src/main/ipc/dbPoolManager')

    setActiveSessionResolver(
      () =>
        ({
          capabilities: {
            backend: 'sqlite'
          },
          getDbPool: () => sessionPool as unknown as DbPool
        }) as unknown as StorageSession
    )

    expect(getDbPool()).toBe(sessionPool)

    setActiveSessionResolver(() => null)
  })

  it('returns null from the legacy db pool bridge for an active postgres session', async () => {
    vi.resetModules()

    const { getDbPool, setActiveSessionResolver } =
      await import('../../../src/main/ipc/dbPoolManager')

    setActiveSessionResolver(
      () =>
        ({
          capabilities: {
            backend: 'postgres'
          }
        }) as unknown as StorageSession
    )

    expect(getDbPool()).toBeNull()

    setActiveSessionResolver(() => null)
  })
})
