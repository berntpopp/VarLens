import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DatabaseManager } from '../../../src/main/services/DatabaseManager'
import { RecentDatabasesService } from '../../../src/main/services/RecentDatabasesService'
import type { StorageSession } from '../../../src/main/storage/session'

let tempDir: string | null = null

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
      capabilities: {
        backend: 'postgres',
        supportsEncryptionAtRest: false,
        supportsLocalFileLifecycle: false,
        supportsHostedConnectionLifecycle: true,
        supportsWorkerReadPool: false,
        supportsFullTextSearch: false
      },
      listCases: async () => [],
      getDatabaseService: () => {
        throw new Error('DatabaseService is not available for postgres sessions')
      },
      getDbPool: () => {
        throw new Error('DbPool is not available for postgres sessions')
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
    expect(manager.getCurrentInfo()).toBeNull()

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
})
