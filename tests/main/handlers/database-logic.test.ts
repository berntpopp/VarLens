/**
 * Database logic smoke tests plus domain registration coverage.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { resolve, join } from 'path'
import * as logic from '../../../src/main/ipc/handlers/database-logic'
import {
  recoverySidecarPathFor,
  writeRecoverySidecar
} from '../../../src/main/database/recovery-sidecar'
import { DatabaseError, WrongPasswordError } from '../../../src/main/database/errors'
import {
  DbKeyStore,
  type PassphraseWrap,
  type SafeStorageLike
} from '../../../src/main/database/db-key-store'
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
    expect(typeof logic.setRecoveryPassphrase).toBe('function')
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
  resolveKeyWithPassphrase: vi.fn(),
  resolveKeyWithPassphraseFromSidecar: vi.fn(),
  findManagedKeyIdForDek: vi.fn(),
  enrollRecoveredKey: vi.fn(),
  updatePath: vi.fn(),
  removeKey: vi.fn(),
  activateKey: vi.fn(),
  getKeyStateForPath: vi.fn().mockReturnValue(null),
  setPassphraseForVerifiedDek: vi.fn(),
  getKeyIdForPath: vi.fn().mockReturnValue(null)
}

describe('database lifecycle logic', () => {
  it('removes an abandoned pending migration key only after plaintext detection succeeds', async () => {
    const manager = {
      openDetectEncryption: vi.fn().mockReturnValue({ needsPassword: false }),
      switchDatabase: vi.fn().mockResolvedValue(undefined),
      getCurrentInfo: vi.fn().mockReturnValue({
        path: '/tmp/pending.db',
        name: 'pending.db',
        encrypted: false
      })
    }
    const keyStore = {
      ...unusedKeyStore,
      getKeyStateForPath: vi.fn().mockReturnValue('pending'),
      getKeyIdForPath: vi.fn().mockReturnValue('pending-key'),
      removeKey: vi.fn()
    }

    await logic.openDatabase(
      { path: '/tmp/pending.db' },
      () => ({}) as never,
      () => manager as never,
      { triggerStartupRebuild: vi.fn() },
      keyStore
    )

    expect(manager.switchDatabase).toHaveBeenCalledWith('/tmp/pending.db', undefined)
    expect(keyStore.removeKey).toHaveBeenCalledWith('pending-key')
    expect(keyStore.activateKey).not.toHaveBeenCalled()
  })

  it('activates a pending migration key only after the encrypted database accepts it', async () => {
    const manager = {
      openDetectEncryption: vi.fn().mockReturnValue({ needsPassword: true }),
      switchDatabase: vi.fn().mockResolvedValue(undefined),
      getCurrentInfo: vi.fn().mockReturnValue({
        path: '/tmp/pending.db',
        name: 'pending.db',
        encrypted: true
      })
    }
    const keyStore = {
      ...unusedKeyStore,
      resolveKeyForPath: vi.fn().mockReturnValue({ ok: true, dek: 'verified-dek' }),
      getKeyStateForPath: vi.fn().mockReturnValue('pending'),
      getKeyIdForPath: vi.fn().mockReturnValue('pending-key'),
      activateKey: vi.fn()
    }

    await logic.openDatabase(
      { path: '/tmp/pending.db' },
      () => ({}) as never,
      () => manager as never,
      { triggerStartupRebuild: vi.fn() },
      keyStore
    )

    expect(manager.switchDatabase).toHaveBeenCalledWith('/tmp/pending.db', 'verified-dek')
    expect(keyStore.activateKey).toHaveBeenCalledWith('pending-key')
  })
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

  describe('opening with a supplied password — recovery sidecar resolution', () => {
    let tmpDir: string
    let dbPath: string
    const dummyPassWrap: PassphraseWrap = {
      saltB64: Buffer.alloc(16, 1).toString('base64'),
      ivB64: Buffer.alloc(12, 2).toString('base64'),
      ctB64: Buffer.from('a'.repeat(64)).toString('base64'),
      tagB64: Buffer.alloc(16, 3).toString('base64')
    }

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'varlens-open-sidecar-'))
      dbPath = join(tmpDir, 'moved.db')
    })

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true })
    })

    it('BLOCKER 1: a sidecar unwrap failure is NOT terminal -- it falls through to a raw-key attempt, and a wrong raw key still surfaces as WRONG_PASSWORD', async () => {
      writeRecoverySidecar(dbPath, dummyPassWrap)
      const manager = {
        openDetectEncryption: vi.fn().mockReturnValue({ needsPassword: true }),
        switchDatabase: vi.fn().mockRejectedValue(new WrongPasswordError())
      }
      const keyStore = {
        ...unusedKeyStore,
        resolveKeyWithPassphrase: vi.fn().mockReturnValue({ ok: false, reason: 'not-found' }),
        resolveKeyWithPassphraseFromSidecar: vi
          .fn()
          .mockReturnValue({ ok: false, reason: 'wrong-passphrase' })
      }

      await expect(
        logic.openDatabase(
          { path: dbPath, password: 'wrong-guess' },
          () => ({}) as never,
          () => manager as never,
          { triggerStartupRebuild: vi.fn() },
          keyStore
        )
      ).resolves.toEqual({ success: false, error: 'WRONG_PASSWORD' })

      // Falls through to the raw-key fallback -- switchDatabase IS attempted
      // with the supplied value, unlike the old terminal-on-sidecar-failure
      // behavior. It's the actual DB-open failure that reports WRONG_PASSWORD.
      expect(manager.switchDatabase).toHaveBeenCalledWith(dbPath, 'wrong-guess')
      expect(keyStore.enrollRecoveredKey).not.toHaveBeenCalled()
      expect(keyStore.updatePath).not.toHaveBeenCalled()
    })

    it('BLOCKER 1: a stale/wrong recovery sidecar is not terminal -- the actual (raw) SQLCipher password still opens the database', async () => {
      // Regression scenario: a legacy `rekeyDatabase` call changed the live
      // SQLCipher key directly without updating the sidecar, so the sidecar
      // on disk no longer decrypts with ANY passphrase that matches the
      // real key. The user supplies the actual current raw password.
      writeRecoverySidecar(dbPath, dummyPassWrap)
      const manager = {
        openDetectEncryption: vi.fn().mockReturnValue({ needsPassword: true }),
        switchDatabase: vi.fn().mockResolvedValue(undefined),
        getCurrentInfo: vi.fn().mockReturnValue({ path: dbPath, name: 'moved.db', encrypted: true })
      }
      const keyStore = {
        ...unusedKeyStore,
        resolveKeyWithPassphrase: vi.fn().mockReturnValue({ ok: false, reason: 'not-found' }),
        resolveKeyWithPassphraseFromSidecar: vi
          .fn()
          .mockReturnValue({ ok: false, reason: 'wrong-passphrase' })
      }

      await expect(
        logic.openDatabase(
          { path: dbPath, password: 'the-real-post-rekey-password' },
          () => ({}) as never,
          () => manager as never,
          { triggerStartupRebuild: vi.fn() },
          keyStore
        )
      ).resolves.toMatchObject({ success: true })

      expect(manager.switchDatabase).toHaveBeenCalledWith(dbPath, 'the-real-post-rekey-password')
    })

    it('same-machine move self-heal: a sidecar-recovered DEK that matches an existing LOCAL managed entry repoints that entry via updatePath instead of enrolling a new one', async () => {
      writeRecoverySidecar(dbPath, dummyPassWrap)
      const manager = {
        openDetectEncryption: vi.fn().mockReturnValue({ needsPassword: true }),
        switchDatabase: vi.fn().mockResolvedValue(undefined),
        getCurrentInfo: vi.fn().mockReturnValue({ path: dbPath, name: 'moved.db', encrypted: true })
      }
      const keyStore = {
        ...unusedKeyStore,
        resolveKeyWithPassphrase: vi.fn().mockReturnValue({ ok: false, reason: 'not-found' }),
        resolveKeyWithPassphraseFromSidecar: vi
          .fn()
          .mockReturnValue({ ok: true, dek: 'recovered-dek' }),
        findManagedKeyIdForDek: vi.fn().mockReturnValue('existing-key-id'),
        updatePath: vi.fn(),
        enrollRecoveredKey: vi.fn()
      }

      await expect(
        logic.openDatabase(
          { path: dbPath, password: 'correct horse battery staple' },
          () => ({}) as never,
          () => manager as never,
          { triggerStartupRebuild: vi.fn() },
          keyStore
        )
      ).resolves.toMatchObject({ success: true })

      expect(keyStore.findManagedKeyIdForDek).toHaveBeenCalledWith('recovered-dek')
      expect(keyStore.updatePath).toHaveBeenCalledWith('existing-key-id', dbPath)
      expect(keyStore.enrollRecoveredKey).not.toHaveBeenCalled()
      expect(manager.switchDatabase).toHaveBeenCalledWith(dbPath, 'recovered-dek')
    })

    it('does not repoint or enroll a sidecar-recovered key until the database accepts the DEK', async () => {
      writeRecoverySidecar(dbPath, dummyPassWrap)
      const manager = {
        openDetectEncryption: vi.fn().mockReturnValue({ needsPassword: true }),
        switchDatabase: vi.fn().mockRejectedValue(new WrongPasswordError())
      }
      const keyStore = {
        ...unusedKeyStore,
        resolveKeyWithPassphrase: vi.fn().mockReturnValue({ ok: false, reason: 'not-found' }),
        resolveKeyWithPassphraseFromSidecar: vi
          .fn()
          .mockReturnValue({ ok: true, dek: 'unverified-dek' }),
        findManagedKeyIdForDek: vi.fn().mockReturnValue('existing-key-id'),
        updatePath: vi.fn(),
        enrollRecoveredKey: vi.fn()
      }

      await expect(
        logic.openDatabase(
          { path: dbPath, password: 'passphrase-for-a-mismatched-sidecar' },
          () => ({}) as never,
          () => manager as never,
          { triggerStartupRebuild: vi.fn() },
          keyStore
        )
      ).resolves.toEqual({ success: false, error: 'WRONG_PASSWORD' })

      expect(keyStore.findManagedKeyIdForDek).not.toHaveBeenCalled()
      expect(keyStore.updatePath).not.toHaveBeenCalled()
      expect(keyStore.enrollRecoveredKey).not.toHaveBeenCalled()
    })

    it('genuinely new machine: a sidecar-recovered DEK with no matching local entry is enrolled fresh via enrollRecoveredKey', async () => {
      writeRecoverySidecar(dbPath, dummyPassWrap)
      const manager = {
        openDetectEncryption: vi.fn().mockReturnValue({ needsPassword: true }),
        switchDatabase: vi.fn().mockResolvedValue(undefined),
        getCurrentInfo: vi.fn().mockReturnValue({ path: dbPath, name: 'moved.db', encrypted: true })
      }
      const keyStore = {
        ...unusedKeyStore,
        resolveKeyWithPassphrase: vi.fn().mockReturnValue({ ok: false, reason: 'not-found' }),
        resolveKeyWithPassphraseFromSidecar: vi
          .fn()
          .mockReturnValue({ ok: true, dek: 'recovered-dek' }),
        findManagedKeyIdForDek: vi.fn().mockReturnValue(null),
        updatePath: vi.fn(),
        enrollRecoveredKey: vi.fn().mockReturnValue({ ok: true, keyId: 'new-key-id' })
      }

      await expect(
        logic.openDatabase(
          { path: dbPath, password: 'correct horse battery staple' },
          () => ({}) as never,
          () => manager as never,
          { triggerStartupRebuild: vi.fn() },
          keyStore
        )
      ).resolves.toMatchObject({ success: true })

      expect(keyStore.enrollRecoveredKey).toHaveBeenCalledWith(
        dbPath,
        'recovered-dek',
        dummyPassWrap
      )
      expect(keyStore.updatePath).not.toHaveBeenCalled()
      expect(manager.switchDatabase).toHaveBeenCalledWith(dbPath, 'recovered-dek')
    })

    it('no sidecar and no registry entry at this path: legacy fallback treats the supplied value as a raw SQLCipher key, unchanged', async () => {
      // Deliberately no `writeRecoverySidecar` call -- this path has neither a
      // registry entry nor a sidecar.
      const manager = {
        openDetectEncryption: vi.fn().mockReturnValue({ needsPassword: true }),
        switchDatabase: vi.fn().mockResolvedValue(undefined),
        getCurrentInfo: vi.fn().mockReturnValue({ path: dbPath, name: 'moved.db', encrypted: true })
      }
      const keyStore = {
        ...unusedKeyStore,
        resolveKeyWithPassphrase: vi.fn().mockReturnValue({ ok: false, reason: 'not-found' })
      }

      await expect(
        logic.openDatabase(
          { path: dbPath, password: 'literal-sqlcipher-key' },
          () => ({}) as never,
          () => manager as never,
          { triggerStartupRebuild: vi.fn() },
          keyStore
        )
      ).resolves.toMatchObject({ success: true })

      expect(manager.switchDatabase).toHaveBeenCalledWith(dbPath, 'literal-sqlcipher-key')
      expect(keyStore.resolveKeyWithPassphraseFromSidecar).not.toHaveBeenCalled()
    })
  })

  describe('keyManaged attachment (BLOCKER 1: renderer UI gating for Change Password vs Set Recovery Passphrase)', () => {
    it('openDatabase reports keyManaged: true when the opened path has a key-store registry entry', async () => {
      const manager = {
        openDetectEncryption: vi.fn().mockReturnValue({ needsPassword: false }),
        switchDatabase: vi.fn().mockResolvedValue(undefined),
        getCurrentInfo: vi
          .fn()
          .mockReturnValue({ path: '/tmp/managed.db', name: 'managed.db', encrypted: true })
      }
      const keyStore = { ...unusedKeyStore, getKeyIdForPath: vi.fn().mockReturnValue('key-1') }

      const result = await logic.openDatabase(
        { path: '/tmp/managed.db' },
        () => ({}) as never,
        () => manager as never,
        { triggerStartupRebuild: vi.fn() },
        keyStore
      )

      expect(result).toMatchObject({ success: true, info: { keyManaged: true } })
      expect(keyStore.getKeyIdForPath).toHaveBeenCalledWith('/tmp/managed.db')
    })

    it('openDatabase reports keyManaged: false for a legacy explicit-password database with no registry entry', async () => {
      const manager = {
        openDetectEncryption: vi.fn().mockReturnValue({ needsPassword: false }),
        switchDatabase: vi.fn().mockResolvedValue(undefined),
        getCurrentInfo: vi
          .fn()
          .mockReturnValue({ path: '/tmp/legacy.db', name: 'legacy.db', encrypted: true })
      }
      const keyStore = { ...unusedKeyStore, getKeyIdForPath: vi.fn().mockReturnValue(null) }

      const result = await logic.openDatabase(
        { path: '/tmp/legacy.db' },
        () => ({}) as never,
        () => manager as never,
        { triggerStartupRebuild: vi.fn() },
        keyStore
      )

      expect(result).toMatchObject({ success: true, info: { keyManaged: false } })
    })

    it('createDatabase reports keyManaged: false for an explicit-password create', async () => {
      const manager = {
        createDatabase: vi.fn().mockResolvedValue(undefined),
        getCurrentInfo: vi
          .fn()
          .mockReturnValue({ path: '/tmp/explicit.db', name: 'explicit.db', encrypted: true })
      }

      const result = await logic.createDatabase(
        { path: '/tmp/explicit.db', password: 'literal-pw' },
        () => manager as never,
        unusedKeyStore
      )

      expect(result).toMatchObject({ success: true, info: { keyManaged: false } })
    })

    it('createDatabase reports keyManaged: true for a setupPassphrase create', async () => {
      const manager = {
        createDatabase: vi.fn().mockResolvedValue(undefined),
        getCurrentInfo: vi
          .fn()
          .mockReturnValue({ path: '/tmp/passphrase.db', name: 'passphrase.db', encrypted: true })
      }
      const keyStore = {
        ...unusedKeyStore,
        wrapNewDekWithPassphrase: vi
          .fn()
          .mockReturnValue({ ok: true, keyId: 'k1', dek: 'wrapped-dek', sidecarWritten: true })
      }

      const result = await logic.createDatabase(
        { path: '/tmp/passphrase.db', setupPassphrase: 'hunter2' },
        () => manager as never,
        keyStore
      )

      expect(result).toMatchObject({ success: true, info: { keyManaged: true } })
    })

    it('createDatabase reports keyManaged: true for a default encrypted-by-default create', async () => {
      const manager = {
        createDatabase: vi.fn().mockResolvedValue(undefined),
        getCurrentInfo: vi
          .fn()
          .mockReturnValue({ path: '/tmp/default.db', name: 'default.db', encrypted: true })
      }
      const keyStore = {
        ...unusedKeyStore,
        createManagedKey: vi.fn().mockReturnValue({ ok: true, keyId: 'k1', dek: 'the-dek' })
      }

      const result = await logic.createDatabase(
        { path: '/tmp/default.db' },
        () => manager as never,
        keyStore
      )

      expect(result).toMatchObject({ success: true, info: { keyManaged: true } })
    })

    it('getDatabaseInfo attaches keyManaged based on the registry, and passes null through unchanged', () => {
      const managerManaged = {
        getCurrentInfo: vi
          .fn()
          .mockReturnValue({ path: '/tmp/managed.db', name: 'managed.db', encrypted: true })
      }
      const managedKeyStore = { getKeyIdForPath: vi.fn().mockReturnValue('key-1') }
      expect(logic.getDatabaseInfo(() => managerManaged as never, managedKeyStore)).toMatchObject({
        keyManaged: true
      })

      const managerNoDb = { getCurrentInfo: vi.fn().mockReturnValue(null) }
      const unusedLookup = { getKeyIdForPath: vi.fn() }
      expect(logic.getDatabaseInfo(() => managerNoDb as never, unusedLookup)).toBeNull()
      expect(unusedLookup.getKeyIdForPath).not.toHaveBeenCalled()
    })
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
        .mockReturnValue({ ok: true, keyId: 'k1', dek: 'wrapped-dek', sidecarWritten: true })
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

  it('fails passphrase-only creation closed when the portable recovery sidecar was not written', async () => {
    const manager = { createDatabase: vi.fn(), getCurrentInfo: vi.fn() }
    const keyStore = {
      ...unusedKeyStore,
      wrapNewDekWithPassphrase: vi.fn().mockReturnValue({
        ok: true,
        keyId: 'k1',
        dek: 'wrapped-dek',
        sidecarWritten: false
      }),
      removeKey: vi.fn()
    }

    const result = await logic.createDatabase(
      { path: '/tmp/varlens.db', setupPassphrase: 'my passphrase' },
      () => manager as never,
      keyStore
    )

    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/recovery/i) })
    expect(keyStore.removeKey).toHaveBeenCalledWith('k1')
    expect(manager.createDatabase).not.toHaveBeenCalled()
  })

  it('rolls back the managed key-store entry when createDatabase throws after minting it', async () => {
    const manager = {
      createDatabase: vi.fn().mockRejectedValue(new Error('disk full')),
      getCurrentInfo: vi.fn()
    }
    const keyStore = {
      ...unusedKeyStore,
      createManagedKey: vi.fn().mockReturnValue({ ok: true, keyId: 'k1', dek: 'the-dek' }),
      removeKey: vi.fn()
    }

    await expect(
      logic.createDatabase({ path: '/tmp/varlens.db' }, () => manager as never, keyStore)
    ).rejects.toThrow('disk full')

    expect(keyStore.removeKey).toHaveBeenCalledWith('k1')
  })

  it('rolls back the passphrase-wrapped key-store entry when createDatabase throws after minting it', async () => {
    const manager = {
      createDatabase: vi.fn().mockRejectedValue(new Error('disk full')),
      getCurrentInfo: vi.fn()
    }
    const keyStore = {
      ...unusedKeyStore,
      wrapNewDekWithPassphrase: vi
        .fn()
        .mockReturnValue({ ok: true, keyId: 'k1', dek: 'wrapped-dek', sidecarWritten: true }),
      removeKey: vi.fn()
    }

    await expect(
      logic.createDatabase(
        { path: '/tmp/varlens.db', setupPassphrase: 'my passphrase' },
        () => manager as never,
        keyStore
      )
    ).rejects.toThrow('disk full')

    expect(keyStore.removeKey).toHaveBeenCalledWith('k1')
  })

  describe('rekeyDatabase', () => {
    it('BLOCKER 1: refuses to rekey a key-store-managed database -- no PRAGMA rekey is executed', () => {
      const manager = {
        getCurrentPath: vi.fn().mockReturnValue('/tmp/managed.db'),
        rekey: vi.fn()
      }
      const keyStore = { getKeyIdForPath: vi.fn().mockReturnValue('key-id-1') }

      expect(() => logic.rekeyDatabase('new-password', () => manager as never, keyStore)).toThrow(
        DatabaseError
      )
      expect(() => logic.rekeyDatabase('new-password', () => manager as never, keyStore)).toThrow(
        /managed encryption key/i
      )

      expect(manager.rekey).not.toHaveBeenCalled()
      expect(keyStore.getKeyIdForPath).toHaveBeenCalledWith('/tmp/managed.db')
    })

    it('still rekeys a legacy explicit-password database with no key-store entry', () => {
      const manager = {
        getCurrentPath: vi.fn().mockReturnValue('/tmp/legacy.db'),
        rekey: vi.fn()
      }
      const keyStore = { getKeyIdForPath: vi.fn().mockReturnValue(null) }

      expect(logic.rekeyDatabase('new-password', () => manager as never, keyStore)).toEqual({
        success: true
      })

      expect(manager.rekey).toHaveBeenCalledWith('new-password')
    })

    it('rekeys when no database is currently open (unchanged edge-case behavior)', () => {
      const manager = {
        getCurrentPath: vi.fn().mockReturnValue(null),
        rekey: vi.fn()
      }
      const keyStore = { getKeyIdForPath: vi.fn() }

      expect(logic.rekeyDatabase('new-password', () => manager as never, keyStore)).toEqual({
        success: true
      })

      expect(manager.rekey).toHaveBeenCalledWith('new-password')
      expect(keyStore.getKeyIdForPath).not.toHaveBeenCalled()
    })
  })

  describe('setRecoveryPassphrase', () => {
    it('throws a typed DatabaseError when no database is currently open', () => {
      const manager = { getCurrentPath: vi.fn().mockReturnValue(null) }
      const keyStore = { setPassphraseForVerifiedDek: vi.fn(), getKeyIdForPath: vi.fn() }

      expect(() =>
        logic.setRecoveryPassphrase('my recovery passphrase', () => manager as never, keyStore)
      ).toThrow(DatabaseError)
      expect(() =>
        logic.setRecoveryPassphrase('my recovery passphrase', () => manager as never, keyStore)
      ).toThrow('No database is currently open.')

      expect(keyStore.getKeyIdForPath).not.toHaveBeenCalled()
      expect(keyStore.setPassphraseForVerifiedDek).not.toHaveBeenCalled()
    })

    it('throws a distinct typed DatabaseError when the open database has no managed key', () => {
      const manager = { getCurrentPath: vi.fn().mockReturnValue('/tmp/explicit-password.db') }
      const keyStore = {
        setPassphraseForVerifiedDek: vi.fn(),
        getKeyIdForPath: vi.fn().mockReturnValue(null)
      }

      let thrown: unknown
      try {
        logic.setRecoveryPassphrase('my recovery passphrase', () => manager as never, keyStore)
      } catch (e) {
        thrown = e
      }

      expect(thrown).toBeInstanceOf(DatabaseError)
      expect((thrown as Error).message).not.toBe('No database is currently open.')
      expect((thrown as Error).message).toMatch(/no managed encryption key/i)
      expect(keyStore.setPassphraseForVerifiedDek).not.toHaveBeenCalled()
    })

    it('throws a typed DatabaseError when the key-store cannot resolve the DEK to wrap', () => {
      const manager = {
        getCurrentPath: vi.fn().mockReturnValue('/tmp/varlens.db'),
        getCurrent: vi.fn().mockReturnValue({ getEncryptionKey: () => 'a'.repeat(64) })
      }
      const keyStore = {
        getKeyIdForPath: vi.fn().mockReturnValue('key-1'),
        setPassphraseForVerifiedDek: vi
          .fn()
          .mockReturnValue({ ok: false, reason: 'cannot-resolve-dek' })
      }

      expect(() =>
        logic.setRecoveryPassphrase('my recovery passphrase', () => manager as never, keyStore)
      ).toThrow(DatabaseError)
      expect(keyStore.setPassphraseForVerifiedDek).toHaveBeenCalledWith(
        'key-1',
        'a'.repeat(64),
        'my recovery passphrase'
      )
    })

    it('succeeds non-destructively: calls only keyStore.setPassphrase, never a rekey/database-write path', () => {
      const manager = {
        getCurrentPath: vi.fn().mockReturnValue('/tmp/varlens.db'),
        getCurrent: vi.fn().mockReturnValue({ getEncryptionKey: () => 'a'.repeat(64) }),
        rekey: vi.fn(),
        createDatabase: vi.fn(),
        switchDatabase: vi.fn()
      }
      const keyStore = {
        getKeyIdForPath: vi.fn().mockReturnValue('key-1'),
        setPassphraseForVerifiedDek: vi.fn().mockReturnValue({ ok: true, sidecarWritten: true })
      }

      const result = logic.setRecoveryPassphrase(
        'my recovery passphrase',
        () => manager as never,
        keyStore
      )

      expect(result).toEqual({
        success: true,
        recoveryPassphraseSet: true,
        sidecarWritten: true
      })
      expect(keyStore.getKeyIdForPath).toHaveBeenCalledWith('/tmp/varlens.db')
      expect(keyStore.setPassphraseForVerifiedDek).toHaveBeenCalledWith(
        'key-1',
        'a'.repeat(64),
        'my recovery passphrase'
      )
      expect(manager.rekey).not.toHaveBeenCalled()
      expect(manager.createDatabase).not.toHaveBeenCalled()
      expect(manager.switchDatabase).not.toHaveBeenCalled()
    })

    it('still reports success when the passphrase wrap succeeds but the sidecar write fails', () => {
      const manager = {
        getCurrentPath: vi.fn().mockReturnValue('/tmp/varlens.db'),
        getCurrent: vi.fn().mockReturnValue({ getEncryptionKey: () => 'a'.repeat(64) })
      }
      const keyStore = {
        getKeyIdForPath: vi.fn().mockReturnValue('key-1'),
        setPassphraseForVerifiedDek: vi.fn().mockReturnValue({ ok: true, sidecarWritten: false })
      }

      const result = logic.setRecoveryPassphrase(
        'my recovery passphrase',
        () => manager as never,
        keyStore
      )

      expect(result).toEqual({
        success: true,
        recoveryPassphraseSet: true,
        sidecarWritten: false
      })
    })
  })
})

describe('managed database deletion', () => {
  it('removes the registry entry and recovery sidecar, permitting the path to be recreated', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'varlens-delete-managed-'))
    const dbPath = join(tmpDir, 'case.db')
    const safeStorage: SafeStorageLike = {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(`SS:${value}`),
      decryptString: (value) => value.toString().replace(/^SS:/, '')
    }
    const keyStore = new DbKeyStore({ registryPath: join(tmpDir, 'keys.json'), safeStorage })

    try {
      writeFileSync(dbPath, 'database bytes')
      const created = keyStore.createManagedKey(dbPath)
      expect(created.ok).toBe(true)
      if (!created.ok) throw new Error('expected managed key')
      expect(keyStore.setPassphrase(created.keyId, 'recovery').ok).toBe(true)

      const manager = {
        getRecentDatabases: () => [{ path: dbPath }],
        getCurrentPath: () => null,
        removeRecentDatabase: vi.fn()
      }
      await logic.deleteDbFile(dbPath, () => manager as never, keyStore)

      expect(existsSync(dbPath)).toBe(false)
      expect(existsSync(recoverySidecarPathFor(dbPath))).toBe(false)
      expect(keyStore.getKeyIdForPath(dbPath)).toBeNull()
      expect(keyStore.createManagedKey(dbPath).ok).toBe(true)
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
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
