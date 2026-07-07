/**
 * Database logic smoke tests plus domain registration coverage.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import * as logic from '../../../src/main/ipc/handlers/database-logic'
import type {
  PostgresConnectionProfileInput,
  PostgresConnectionProfilePublic
} from '../../../src/shared/types/postgres-profile'

const ROOT = resolve(__dirname, '..', '..', '..')

const postgresInput = (
  overrides: Partial<PostgresConnectionProfileInput> = {}
): PostgresConnectionProfileInput => ({
  name: 'Lab PG',
  host: 'db.example.org',
  port: 5432,
  database: 'varlens',
  username: 'varlens_app',
  schema: 'workspace_a',
  sslMode: 'require-verify',
  poolMax: 4,
  connectionTimeoutMillis: 5000,
  statementTimeoutMs: 30000,
  lockTimeoutMs: 5000,
  idleInTransactionSessionTimeoutMs: 10000,
  secrets: { password: 'super-secret', caCertificatePem: '-----BEGIN CERTIFICATE-----abc' },
  ...overrides
})

const publicProfile = (
  overrides: Partial<PostgresConnectionProfilePublic> = {}
): PostgresConnectionProfilePublic => ({
  id: 'profile-1',
  name: 'Lab PG',
  host: 'db.example.org',
  port: 5432,
  database: 'varlens',
  username: 'varlens_app',
  schema: 'workspace_a',
  sslMode: 'require-verify',
  poolMax: 4,
  connectionTimeoutMillis: 5000,
  statementTimeoutMs: 30000,
  lockTimeoutMs: 5000,
  idleInTransactionSessionTimeoutMs: 10000,
  caCertificateConfigured: true,
  ...overrides
})

afterEach(() => {
  vi.resetModules()
  vi.doUnmock('../../../src/main/ipc/handlers/database')
  vi.doUnmock('../../../src/main/ipc/handlers/filter-presets')
  vi.doUnmock('../../../src/main/database')
  vi.doUnmock('../../../src/main/ipc/dbPoolManager')
})

describe('database-logic exports', () => {
  it('exports expected functions', () => {
    expect(typeof logic.openDatabase).toBe('function')
    expect(typeof logic.createDatabase).toBe('function')
    expect(typeof logic.rekeyDatabase).toBe('function')
    expect(typeof logic.getDatabaseInfo).toBe('function')
    expect(typeof logic.getRecentDatabases).toBe('function')
    expect(typeof logic.getDatabaseOverview).toBe('function')
    expect(typeof logic.removeRecentDatabase).toBe('function')
    expect(typeof logic.deleteDbFile).toBe('function')
    expect(typeof logic.listPostgresProfiles).toBe('function')
    expect(typeof logic.savePostgresProfile).toBe('function')
    expect(typeof logic.removePostgresProfile).toBe('function')
    expect(typeof logic.testPostgresProfile).toBe('function')
    expect(typeof logic.openPostgresProfile).toBe('function')
  })
})

describe('postgres profile logic', () => {
  it('lists, saves, and removes profiles through the injected profile store', async () => {
    const profile = publicProfile()
    const store = {
      listProfiles: vi.fn().mockResolvedValue([profile]),
      saveProfile: vi.fn().mockResolvedValue(profile),
      removeProfile: vi.fn().mockResolvedValue(undefined)
    }

    await expect(logic.listPostgresProfiles(store)).resolves.toEqual([profile])
    await expect(logic.savePostgresProfile(postgresInput(), store)).resolves.toEqual(profile)
    await expect(logic.removePostgresProfile('profile-1', store)).resolves.toEqual({
      success: true
    })

    expect(store.listProfiles).toHaveBeenCalledOnce()
    expect(store.saveProfile).toHaveBeenCalledWith(postgresInput())
    expect(store.removeProfile).toHaveBeenCalledWith('profile-1')
  })

  it('tests a postgres profile with a temporary pool and closes it without opening a session', async () => {
    const pool = { end: vi.fn().mockResolvedValue(undefined), query: vi.fn() }
    const createPool = vi.fn().mockReturnValue(pool)
    const collectDiagnostics = vi.fn().mockResolvedValue({
      ok: true,
      serverVersion: 'PostgreSQL 16',
      currentUser: 'varlens_app',
      schema: 'workspace_a',
      currentMigration: '006'
    })
    const manager = { openPostgresSession: vi.fn() }

    await expect(
      logic.testPostgresProfile(postgresInput(), {
        createPool,
        collectDiagnostics
      })
    ).resolves.toEqual({
      ok: true,
      serverVersion: 'PostgreSQL 16',
      currentUser: 'varlens_app',
      database: 'varlens',
      schema: 'workspace_a',
      currentMigration: '006'
    })

    expect(createPool).toHaveBeenCalledOnce()
    expect(collectDiagnostics).toHaveBeenCalledWith(pool, 'workspace_a')
    expect(pool.end).toHaveBeenCalledOnce()
    expect(manager.openPostgresSession).not.toHaveBeenCalled()
  })

  it('redacts postgres test failure messages before returning them', async () => {
    const pool = { end: vi.fn().mockResolvedValue(undefined), query: vi.fn() }

    const result = await logic.testPostgresProfile(postgresInput(), {
      createPool: vi.fn().mockReturnValue(pool),
      collectDiagnostics: vi.fn().mockResolvedValue({
        ok: false,
        schema: 'workspace_a',
        message: 'password super-secret failed with -----BEGIN CERTIFICATE-----abc'
      })
    })

    expect(result.ok).toBe(false)
    expect(result.message).not.toContain('super-secret')
    expect(result.message).not.toContain('-----BEGIN CERTIFICATE-----abc')
    expect(pool.end).toHaveBeenCalledOnce()
  })

  it('redacts postgres pool construction failures before returning them', async () => {
    const result = await logic.testPostgresProfile(postgresInput(), {
      createPool: vi.fn(() => {
        throw new Error(
          'failed for postgresql://varlens_app:super-secret@db.example.org:5432/varlens with -----BEGIN CERTIFICATE-----abc'
        )
      })
    })

    expect(result.ok).toBe(false)
    expect(result.message).not.toContain('super-secret')
    expect(result.message).not.toContain('-----BEGIN CERTIFICATE-----abc')
    expect(result.message).not.toContain('varlens_app:super-secret')
  })

  it('redacts postgres test cleanup failures before returning them', async () => {
    const pool = {
      end: vi
        .fn()
        .mockRejectedValue(
          new Error('cleanup failed for super-secret and -----BEGIN CERTIFICATE-----abc')
        ),
      query: vi.fn()
    }

    const result = await logic.testPostgresProfile(postgresInput(), {
      createPool: vi.fn().mockReturnValue(pool),
      collectDiagnostics: vi.fn().mockResolvedValue({
        ok: true,
        schema: 'workspace_a'
      })
    })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('cleanup failed')
    expect(result.message).not.toContain('super-secret')
    expect(result.message).not.toContain('-----BEGIN CERTIFICATE-----abc')
    expect(pool.end).toHaveBeenCalledOnce()
  })

  it('opens a stored postgres profile through DatabaseManager.openPostgresSession', async () => {
    const profile = publicProfile()
    const session = {
      close: vi.fn().mockResolvedValue(undefined),
      workspace: {
        kind: 'postgres',
        schema: 'workspace_a',
        connectionUrlRedacted: 'postgresql://db.example.org:5432/varlens',
        connectionLabel: 'db.example.org:5432/varlens (workspace_a)'
      },
      capabilities: { backend: 'postgres' }
    }
    const expectedInfo = {
      path: 'postgresql://db.example.org:5432/varlens',
      name: 'PostgreSQL: db.example.org:5432/varlens (workspace_a)',
      encrypted: false
    }
    const manager = {
      openPostgresSession: vi.fn().mockResolvedValue(undefined),
      getCurrentInfo: vi.fn().mockReturnValue(expectedInfo)
    }
    const store = {
      listProfiles: vi.fn().mockResolvedValue([profile]),
      getProfileSecrets: vi.fn().mockResolvedValue({
        password: 'super-secret',
        caCertificatePem: '-----BEGIN CERTIFICATE-----abc'
      })
    }
    const createSession = vi.fn().mockResolvedValue(session)

    await expect(
      logic.openPostgresProfile('profile-1', {
        profileStore: store,
        getDbManager: () => manager as never,
        createSession
      })
    ).resolves.toEqual({ success: true, info: expectedInfo })

    expect(store.listProfiles).toHaveBeenCalledOnce()
    expect(store.getProfileSecrets).toHaveBeenCalledWith('profile-1')
    expect(createSession).toHaveBeenCalledOnce()
    expect(createSession.mock.calls[0][0]).toMatchObject({
      schema: 'workspace_a',
      applicationName: 'varlens-main'
    })
    expect(manager.openPostgresSession).toHaveBeenCalledWith(session)
    expect(session.close).not.toHaveBeenCalled()
  })

  it('does not switch the active session when postgres profile migration fails', async () => {
    const profile = publicProfile()
    const manager = {
      openPostgresSession: vi.fn(),
      getCurrentInfo: vi.fn()
    }
    const store = {
      listProfiles: vi.fn().mockResolvedValue([profile]),
      getProfileSecrets: vi.fn().mockResolvedValue({
        password: 'super-secret',
        caCertificatePem: '-----BEGIN CERTIFICATE-----abc'
      })
    }
    const createSession = vi.fn().mockRejectedValue(new Error('migration failed'))

    await expect(
      logic.openPostgresProfile('profile-1', {
        profileStore: store,
        getDbManager: () => manager as never,
        createSession
      })
    ).rejects.toThrow('Failed to open PostgreSQL profile "Lab PG": migration failed')

    expect(createSession).toHaveBeenCalledOnce()
    expect(manager.openPostgresSession).not.toHaveBeenCalled()
  })
})

/** A key-store stub that never resolves/mints anything -- for tests that don't exercise it. */
const unusedKeyStore = {
  createManagedKey: vi.fn(),
  wrapNewDekWithPassphrase: vi.fn(),
  resolveKeyForPath: vi.fn(),
  resolveKeyWithPassphrase: vi.fn()
}

describe('database lifecycle logic', () => {
  it('does not require handler-level pool initialization after opening a database', async () => {
    const initDbPool = vi.fn()
    const triggerStartupRebuild = vi.fn()
    const db = {}
    const manager = {
      openDetectEncryption: vi.fn().mockReturnValue({ needsPassword: false }),
      switchDatabase: vi.fn().mockResolvedValue(undefined),
      getCurrentInfo: vi.fn().mockReturnValue({
        path: '/tmp/varlens.db',
        name: 'varlens.db',
        encrypted: false
      })
    }

    const callbacks = { initDbPool, triggerStartupRebuild }

    await expect(
      logic.openDatabase(
        { path: '/tmp/varlens.db' },
        () => db as never,
        () => manager as never,
        callbacks,
        unusedKeyStore
      )
    ).resolves.toMatchObject({ success: true })

    expect(initDbPool).not.toHaveBeenCalled()
    expect(triggerStartupRebuild).toHaveBeenCalledWith(db)
    expect(unusedKeyStore.resolveKeyForPath).not.toHaveBeenCalled()
  })

  it('opening an encrypted database with no password resolves the key transparently via the key-store', async () => {
    const triggerStartupRebuild = vi.fn()
    const manager = {
      openDetectEncryption: vi.fn().mockReturnValue({ needsPassword: true }),
      switchDatabase: vi.fn().mockResolvedValue(undefined),
      getCurrentInfo: vi.fn().mockReturnValue({
        path: '/tmp/varlens.db',
        name: 'varlens.db',
        encrypted: true
      })
    }
    const keyStore = {
      ...unusedKeyStore,
      resolveKeyForPath: vi.fn().mockReturnValue({ ok: true, dek: 'the-dek' })
    }

    await expect(
      logic.openDatabase(
        { path: '/tmp/varlens.db' },
        () => ({}) as never,
        () => manager as never,
        { triggerStartupRebuild },
        keyStore
      )
    ).resolves.toMatchObject({ success: true })

    expect(keyStore.resolveKeyForPath).toHaveBeenCalledWith('/tmp/varlens.db')
    expect(manager.switchDatabase).toHaveBeenCalledWith('/tmp/varlens.db', 'the-dek')
  })

  it('opening an encrypted database the key-store cannot resolve falls back to needsPassword', async () => {
    const manager = {
      openDetectEncryption: vi.fn().mockReturnValue({ needsPassword: true }),
      switchDatabase: vi.fn()
    }
    const keyStore = {
      ...unusedKeyStore,
      resolveKeyForPath: vi.fn().mockReturnValue({ ok: false, reason: 'not-found' })
    }

    await expect(
      logic.openDatabase(
        { path: '/tmp/varlens.db' },
        () => ({}) as never,
        () => manager as never,
        { triggerStartupRebuild: vi.fn() },
        keyStore
      )
    ).resolves.toEqual({ success: false, needsPassword: true })

    expect(manager.switchDatabase).not.toHaveBeenCalled()
  })

  it('does not require handler-level pool initialization after creating a database', async () => {
    const initDbPool = vi.fn()
    const manager = {
      createDatabase: vi.fn().mockResolvedValue(undefined),
      getCurrentInfo: vi.fn().mockReturnValue({
        path: '/tmp/varlens.db',
        name: 'varlens.db',
        encrypted: false
      })
    }
    const keyStore = {
      ...unusedKeyStore,
      createManagedKey: vi.fn().mockReturnValue({ ok: true, keyId: 'k1', dek: 'the-dek' })
    }

    await expect(
      logic.createDatabase({ path: '/tmp/varlens.db' }, () => manager as never, keyStore)
    ).resolves.toMatchObject({ success: true })

    expect(initDbPool).not.toHaveBeenCalled()
    expect(manager.createDatabase).toHaveBeenCalledWith('/tmp/varlens.db', 'the-dek')
  })

  it('creating a database with an explicit password never consults the key-store', async () => {
    const manager = {
      createDatabase: vi.fn().mockResolvedValue(undefined),
      getCurrentInfo: vi.fn().mockReturnValue({
        path: '/tmp/varlens.db',
        name: 'varlens.db',
        encrypted: true
      })
    }

    await expect(
      logic.createDatabase(
        { path: '/tmp/varlens.db', password: 'literal-pw' },
        () => manager as never,
        unusedKeyStore
      )
    ).resolves.toMatchObject({ success: true })

    expect(manager.createDatabase).toHaveBeenCalledWith('/tmp/varlens.db', 'literal-pw')
    expect(unusedKeyStore.createManagedKey).not.toHaveBeenCalled()
  })

  it('creating a database when safeStorage is unavailable returns needsPassphraseSetup without creating anything', async () => {
    const manager = { createDatabase: vi.fn(), getCurrentInfo: vi.fn() }
    const keyStore = {
      ...unusedKeyStore,
      createManagedKey: vi.fn().mockReturnValue({ ok: false, reason: 'safe-storage-unavailable' })
    }

    await expect(
      logic.createDatabase({ path: '/tmp/varlens.db' }, () => manager as never, keyStore)
    ).resolves.toEqual({ success: false, needsPassphraseSetup: true })

    expect(manager.createDatabase).not.toHaveBeenCalled()
  })

  it('completing passphrase setup wraps a fresh DEK and creates the database with it', async () => {
    const manager = {
      createDatabase: vi.fn().mockResolvedValue(undefined),
      getCurrentInfo: vi.fn().mockReturnValue({
        path: '/tmp/varlens.db',
        name: 'varlens.db',
        encrypted: true
      })
    }
    const keyStore = {
      ...unusedKeyStore,
      wrapNewDekWithPassphrase: vi
        .fn()
        .mockReturnValue({ ok: true, keyId: 'k1', dek: 'wrapped-dek' })
    }

    await expect(
      logic.createDatabase(
        { path: '/tmp/varlens.db', setupPassphrase: 'my passphrase' },
        () => manager as never,
        keyStore
      )
    ).resolves.toMatchObject({ success: true })

    expect(keyStore.wrapNewDekWithPassphrase).toHaveBeenCalledWith(
      '/tmp/varlens.db',
      'my passphrase'
    )
    expect(manager.createDatabase).toHaveBeenCalledWith('/tmp/varlens.db', 'wrapped-dek')
  })
})

describe('database IPC domain registration', () => {
  it('delegates database domain registration to database handlers with injected dependencies', async () => {
    const registerDatabaseHandlers = vi.fn()
    const getDatabaseService = vi.fn()
    const getDatabaseManager = vi.fn()
    const getDbPool = vi.fn()
    const ipcMain = { handle: vi.fn() }

    vi.doMock('../../../src/main/ipc/handlers/database', () => ({
      registerDatabaseHandlers
    }))
    vi.doMock('../../../src/main/database', () => ({
      getDatabaseService,
      getDatabaseManager
    }))
    vi.doMock('../../../src/main/ipc/dbPoolManager', () => ({
      getDbPool
    }))

    const { registerDatabaseDomain } = await import('../../../src/main/ipc/domains/database')

    registerDatabaseDomain(ipcMain as never)

    expect(registerDatabaseHandlers).toHaveBeenCalledOnce()
    expect(registerDatabaseHandlers).toHaveBeenCalledWith({
      ipcMain,
      getDb: getDatabaseService,
      getDbManager: getDatabaseManager,
      getDbPool
    })
  })

  it('delegates filter presets domain registration to preset handlers with injected dependencies', async () => {
    const registerFilterPresetHandlers = vi.fn()
    const getDatabaseService = vi.fn()
    const getDatabaseManager = vi.fn()
    const getDbPool = vi.fn()
    const ipcMain = { handle: vi.fn() }

    vi.doMock('../../../src/main/ipc/handlers/filter-presets', () => ({
      registerFilterPresetHandlers
    }))
    vi.doMock('../../../src/main/database', () => ({
      getDatabaseService,
      getDatabaseManager
    }))
    vi.doMock('../../../src/main/ipc/dbPoolManager', () => ({
      getDbPool
    }))

    const { registerFilterPresetsDomain } =
      await import('../../../src/main/ipc/domains/filter-presets')

    registerFilterPresetsDomain(ipcMain as never)

    expect(registerFilterPresetHandlers).toHaveBeenCalledOnce()
    expect(registerFilterPresetHandlers).toHaveBeenCalledWith({
      ipcMain,
      getDb: getDatabaseService,
      getDbManager: getDatabaseManager,
      getDbPool
    })
  })

  it('main IPC index wires the database and filter presets domain modules', () => {
    const indexSource = readFileSync(resolve(ROOT, 'src/main/ipc/index.ts'), 'utf-8')

    expect(indexSource).toContain("import { registerDatabaseDomain } from './domains/database'")
    expect(indexSource).toContain(
      "import { registerFilterPresetsDomain } from './domains/filter-presets'"
    )
    expect(indexSource).toContain('registerDatabaseDomain(ipcMain)')
    expect(indexSource).toContain('registerFilterPresetsDomain(ipcMain)')
  })
})
