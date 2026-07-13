/**
 * Encrypt-by-default for NEW databases (managed key + first-run passphrase).
 *
 * See .superpowers/sdd/task-I2a-brief.md for the full design. These tests
 * exercise `createDatabase`/`openDatabase` from
 * `src/main/ipc/handlers/database-logic.ts` against a REAL `DbKeyStore` and a
 * REAL `DatabaseManager` (better-sqlite3-multiple-ciphers underneath), with
 * only `safeStorage` faked -- so the "encrypted at rest" assertions are
 * proven against the actual SQLCipher file format, not a mock.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3-multiple-ciphers'
import { DbKeyStore, type SafeStorageLike } from '../../../src/main/database/db-key-store'
import { DatabaseManager } from '../../../src/main/services/DatabaseManager'
import { RecentDatabasesService } from '../../../src/main/services/RecentDatabasesService'
import {
  createDatabase,
  openDatabase,
  type DatabaseLifecycleCallbacks
} from '../../../src/main/ipc/handlers/database-logic'

/** Reversible fake "encryption" so round-trips work in tests (same fake as db-key-store.test.ts). */
function fakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s: string) => {
      if (!available) throw new Error('unavailable')
      return Buffer.from('SS:' + s)
    },
    decryptString: (b: Buffer) => b.toString().replace(/^SS:/, '')
  }
}

const noopCallbacks: DatabaseLifecycleCallbacks = {
  triggerStartupRebuild: () => undefined
}

describe('encrypt-by-default for NEW databases', () => {
  let tmpDir: string
  let registryPath: string
  let manager: DatabaseManager

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'varlens-enc-default-'))
    registryPath = join(tmpDir, 'varlens-db-keys.json')
    manager = new DatabaseManager(new RecentDatabasesService(join(tmpDir, 'varlens-settings.json')))
  })

  afterEach(async () => {
    await manager.close()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('a newly created DB (no password) is encrypted at rest: opening with NO key throws the SQLCipher "not a database" error, and opening with the stored DEK succeeds and reads back written data', async () => {
    const keyStore = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })
    const dbPath = join(tmpDir, 'case.db')

    const result = await createDatabase({ path: dbPath }, () => manager, keyStore)
    expect(result.success).toBe(true)
    expect(keyStore.getKeyStateForPath(dbPath)).toBe('active')

    manager.getCurrent().database.exec('CREATE TABLE marker (id INTEGER)')
    manager.getCurrent().database.prepare('INSERT INTO marker (id) VALUES (1)').run()
    await manager.close()

    // Opening the raw file with NO key must fail with SQLCipher's error.
    const rawNoKey = new Database(dbPath)
    expect(() => rawNoKey.prepare('SELECT count(*) FROM sqlite_master').get()).toThrow(
      /file is not a database/i
    )
    rawNoKey.close()

    // Opening with the stored DEK must succeed and read back the data.
    const resolved = keyStore.resolveKeyForPath(dbPath)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) throw new Error('expected ok result')

    const rawWithKey = new Database(dbPath)
    rawWithKey.pragma(`key='${resolved.dek}'`)
    const row = rawWithKey.prepare('SELECT id FROM marker').get() as { id: number }
    expect(row.id).toBe(1)
    rawWithKey.close()
  })

  it('reconciles a crash-abandoned pending create when no database file exists', async () => {
    const keyStore = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })
    const dbPath = join(tmpDir, 'crash-retry.db')
    const abandoned = keyStore.createPendingManagedKey(dbPath)
    expect(abandoned.ok).toBe(true)
    if (!abandoned.ok) throw new Error('expected pending key')

    const result = await createDatabase({ path: dbPath }, () => manager, keyStore)

    expect(result.success).toBe(true)
    expect(keyStore.getKeyStateForPath(dbPath)).toBe('active')
    expect(keyStore.getKeyIdForPath(dbPath)).not.toBe(abandoned.keyId)
    expect(keyStore.resolveKeyForPath(dbPath).ok).toBe(true)
  })

  it('managed round-trip: create, close, and reopen transparently via the key-store -- data intact', async () => {
    const keyStore = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })
    const dbPath = join(tmpDir, 'case.db')

    const created = await createDatabase({ path: dbPath }, () => manager, keyStore)
    expect(created.success).toBe(true)

    manager.getCurrent().database.exec('CREATE TABLE marker (id INTEGER)')
    manager.getCurrent().database.prepare('INSERT INTO marker (id) VALUES (42)').run()
    await manager.close()

    // Fresh manager + fresh key-store instance over the SAME registry file --
    // simulates a second app launch. No password supplied.
    const manager2 = new DatabaseManager(
      new RecentDatabasesService(join(tmpDir, 'varlens-settings-2.json'))
    )
    const keyStore2 = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })

    try {
      const opened = await openDatabase(
        { path: dbPath },
        () => manager2.getCurrent(),
        () => manager2,
        noopCallbacks,
        keyStore2
      )

      expect(opened.success).toBe(true)
      expect(opened.needsPassword).toBeUndefined()

      const row = manager2.getCurrent().database.prepare('SELECT id FROM marker').get() as {
        id: number
      }
      expect(row.id).toBe(42)
    } finally {
      await manager2.close()
    }
  })

  it('safeStorage-unavailable create returns needsPassphraseSetup and does NOT create an unencrypted DB; a follow-up passphrase create succeeds and is encrypted', async () => {
    const keyStore = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(false) })
    const dbPath = join(tmpDir, 'case.db')

    const attempt = await createDatabase({ path: dbPath }, () => manager, keyStore)
    expect(attempt).toEqual({ success: false, needsPassphraseSetup: true })
    expect(existsSync(dbPath)).toBe(false)
    expect(manager.getCurrentPath()).toBeNull()

    const withPassphrase = await createDatabase(
      { path: dbPath, setupPassphrase: 'correct horse battery staple' },
      () => manager,
      keyStore
    )
    expect(withPassphrase.success).toBe(true)
    expect(keyStore.getKeyStateForPath(dbPath)).toBe('active')
    await manager.close()

    // Still encrypted at rest.
    const rawNoKey = new Database(dbPath)
    expect(() => rawNoKey.prepare('SELECT count(*) FROM sqlite_master').get()).toThrow(
      /file is not a database/i
    )
    rawNoKey.close()

    const resolved = keyStore.resolveKeyWithPassphrase(dbPath, 'correct horse battery staple')
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) throw new Error('expected ok result')

    const rawWithKey = new Database(dbPath)
    rawWithKey.pragma(`key='${resolved.dek}'`)
    expect(() => rawWithKey.prepare('SELECT count(*) FROM sqlite_master').get()).not.toThrow()
    rawWithKey.close()
  })

  it('explicit password create/open is unchanged: the password itself is the SQLCipher key and the key-store is never consulted', async () => {
    const keyStore = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })
    const dbPath = join(tmpDir, 'case.db')

    const created = await createDatabase(
      { path: dbPath, password: 'hunter2literal' },
      () => manager,
      keyStore
    )
    expect(created.success).toBe(true)
    await manager.close()

    // The key-store must have no entry for an explicit-password DB.
    expect(keyStore.resolveKeyForPath(dbPath).ok).toBe(false)

    const openedWithNoPassword = await openDatabase(
      { path: dbPath },
      () => manager.getCurrent(),
      () => manager,
      noopCallbacks,
      keyStore
    )
    expect(openedWithNoPassword).toEqual({ success: false, needsPassword: true })

    const openedWithPassword = await openDatabase(
      { path: dbPath, password: 'hunter2literal' },
      () => manager.getCurrent(),
      () => manager,
      noopCallbacks,
      keyStore
    )
    expect(openedWithPassword.success).toBe(true)
  })

  it('open with a wrong password against an explicit-password DB still reports WRONG_PASSWORD', async () => {
    const keyStore = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })
    const dbPath = join(tmpDir, 'case.db')

    await createDatabase({ path: dbPath, password: 'hunter2literal' }, () => manager, keyStore)
    await manager.close()

    const opened = await openDatabase(
      { path: dbPath, password: 'totally-wrong' },
      () => manager.getCurrent(),
      () => manager,
      noopCallbacks,
      keyStore
    )
    expect(opened).toEqual({ success: false, error: 'WRONG_PASSWORD' })
  })

  it('createManagedKey on an already-keyed path never falls back to an unencrypted DB', async () => {
    const keyStore = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })
    const dbPath = join(tmpDir, 'case.db')

    // Pre-register the path against a key (simulating a stale/duplicate registry entry).
    const preexisting = keyStore.createManagedKey(dbPath)
    expect(preexisting.ok).toBe(true)

    const result = await createDatabase({ path: dbPath }, () => manager, keyStore)
    expect(result.success).toBe(false)
    expect(result.needsPassphraseSetup).toBeUndefined()
    expect(existsSync(dbPath)).toBe(false)
  })

  it('a failed managed create rolls back the key-store entry so a retry at the same path is not burned', async () => {
    const keyStore = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })
    const dbPath = join(tmpDir, 'case.db')
    const failingManager = {
      createDatabase: async () => {
        throw new Error('disk full')
      },
      getCurrentInfo: () => null
    }

    await expect(
      createDatabase({ path: dbPath }, () => failingManager as never, keyStore)
    ).rejects.toThrow('disk full')

    // The registry must have NO entry for this path -- a fresh managed-key
    // create at the same path must succeed instead of hitting
    // `path-already-keyed`.
    const retry = keyStore.createManagedKey(dbPath)
    expect(retry.ok).toBe(true)
  })

  it('a failed passphrase-setup create rolls back the key-store entry so a retry at the same path is not burned', async () => {
    const keyStore = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(false) })
    const dbPath = join(tmpDir, 'case.db')
    const failingManager = {
      createDatabase: async () => {
        throw new Error('disk full')
      },
      getCurrentInfo: () => null
    }

    await expect(
      createDatabase(
        { path: dbPath, setupPassphrase: 'correct horse battery staple' },
        () => failingManager as never,
        keyStore
      )
    ).rejects.toThrow('disk full')

    // Same rollback guarantee for the passphrase-wrap path.
    const retry = keyStore.wrapNewDekWithPassphrase(dbPath, 'correct horse battery staple')
    expect(retry.ok).toBe(true)
  })
})
