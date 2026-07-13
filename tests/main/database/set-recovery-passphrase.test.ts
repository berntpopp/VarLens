/**
 * The critical non-destructiveness proof for `setRecoveryPassphrase`
 * (`database-lifecycle-logic.ts`): setting a recovery passphrase on a
 * managed-key database's key must NEVER change the live SQLCipher key (the
 * DEK). Unlike `rekeyDatabase` (a `PRAGMA rekey` that writes a NEW key
 * literally to the database file), this only envelope-wraps the SAME DEK
 * with a passphrase and writes a portable recovery sidecar next to the file.
 *
 * These tests run against a REAL `better-sqlite3-multiple-ciphers` database
 * on real temp files, a REAL `DbKeyStore`, and the REAL `createDatabase` /
 * `openDatabase` / `setRecoveryPassphrase` orchestration from
 * `database-lifecycle-logic.ts` -- no mocking of SQLite or the key-store
 * crypto itself. See `tests/main/database/recovery-portability.test.ts` and
 * `tests/main/database/plaintext-migration.test.ts` for the sibling
 * real-database proofs this mirrors.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DbKeyStore, type SafeStorageLike } from '../../../src/main/database/db-key-store'
import { recoverySidecarPathFor } from '../../../src/main/database/recovery-sidecar'
import { DatabaseManager } from '../../../src/main/services/DatabaseManager'
import { RecentDatabasesService } from '../../../src/main/services/RecentDatabasesService'
import {
  createDatabase,
  openDatabase,
  setRecoveryPassphrase,
  type DatabaseLifecycleCallbacks
} from '../../../src/main/ipc/handlers/database-lifecycle-logic'

/** Reversible fake "encryption" so managed-key round-trips work (same fake as the other DbKeyStore suites). */
function fakeSafeStorage(available: boolean): SafeStorageLike {
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

const PASSPHRASE = 'correct horse battery staple'

interface MarkerRow {
  label: string
}

describe('setRecoveryPassphrase (real DB, non-destructive DEK proof)', () => {
  let tmpDir: string
  let dbPath: string
  let manager: DatabaseManager
  let keyStore: DbKeyStore
  const extraManagers: DatabaseManager[] = []

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'varlens-set-recovery-passphrase-'))
    dbPath = join(tmpDir, 'case.db')
    manager = new DatabaseManager(new RecentDatabasesService(join(tmpDir, 'settings.json')))
    keyStore = new DbKeyStore({
      registryPath: join(tmpDir, 'keys.json'),
      safeStorage: fakeSafeStorage(true)
    })

    // Managed-key create path (no explicit password, no setupPassphrase): mints
    // a safeStorage-wrapped DEK transparently -- the same path a brand-new
    // database takes under encryption-by-default.
    const created = await createDatabase({ path: dbPath }, () => manager, keyStore)
    expect(created.success).toBe(true)

    manager.getCurrent().database.exec('CREATE TABLE marker (id INTEGER PRIMARY KEY, label TEXT)')
    manager
      .getCurrent()
      .database.prepare('INSERT INTO marker (label) VALUES (?)')
      .run('unchanged-row')
  })

  afterEach(async () => {
    await manager.close()
    await Promise.all(extraManagers.map((m) => m.close()))
    extraManagers.length = 0
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function makeManager(label: string): DatabaseManager {
    const m = new DatabaseManager(new RecentDatabasesService(join(tmpDir, `${label}.json`)))
    extraManagers.push(m)
    return m
  }

  it('wraps the SAME DEK, leaves the live session untouched, and makes the DB openable both via keyring and passphrase', async () => {
    const dekBefore = keyStore.resolveKeyForPath(dbPath)
    expect(dekBefore.ok).toBe(true)

    const result = setRecoveryPassphrase(PASSPHRASE, () => manager, keyStore)
    expect(result).toEqual({ success: true, recoveryPassphraseSet: true, sidecarWritten: true })

    // (a) DEK unchanged: the managed (safeStorage) wrap resolves to the exact
    // same DEK before and after -- proof the live SQLCipher key was never
    // touched, unlike `rekeyDatabase`.
    const dekAfter = keyStore.resolveKeyForPath(dbPath)
    expect(dekAfter.ok).toBe(true)
    if (dekBefore.ok && dekAfter.ok) {
      expect(dekAfter.dek).toBe(dekBefore.dek)
    }

    // (b) The live, already-open session was never closed/reopened/rekeyed --
    // same in-memory connection, same rows, still there.
    const liveRows = manager
      .getCurrent()
      .database.prepare('SELECT label FROM marker')
      .all() as MarkerRow[]
    expect(liveRows).toEqual([{ label: 'unchanged-row' }])

    // (c) The database file still opens TRANSPARENTLY via the managed
    // (safeStorage) key -- a fresh DatabaseManager/session against the file
    // on disk, not the live in-memory one, proves the file itself is intact.
    const managerB = makeManager('settings-b')
    const openedTransparently = await openDatabase(
      { path: dbPath },
      () => managerB.getCurrent(),
      () => managerB,
      noopCallbacks,
      keyStore
    )
    expect(openedTransparently.success).toBe(true)
    const rowsViaKeyring = managerB
      .getCurrent()
      .database.prepare('SELECT label FROM marker')
      .all() as MarkerRow[]
    expect(rowsViaKeyring).toEqual([{ label: 'unchanged-row' }])

    // (d) The database ALSO now opens via the recovery passphrase, through a
    // BRAND-NEW key-store with an empty registry for this path -- this
    // exercises the portable recovery-sidecar resolution path specifically
    // (not the registry-only shortcut), proving the sidecar this call wrote
    // is genuinely sufficient on its own.
    const managerC = makeManager('settings-c')
    const keyStoreC = new DbKeyStore({
      registryPath: join(tmpDir, 'keys-c.json'),
      safeStorage: fakeSafeStorage(false)
    })
    const openedViaPassphrase = await openDatabase(
      { path: dbPath, password: PASSPHRASE },
      () => managerC.getCurrent(),
      () => managerC,
      noopCallbacks,
      keyStoreC
    )
    expect(openedViaPassphrase.success).toBe(true)
    const rowsViaPassphrase = managerC
      .getCurrent()
      .database.prepare('SELECT label FROM marker')
      .all() as MarkerRow[]
    expect(rowsViaPassphrase).toEqual([{ label: 'unchanged-row' }])

    // (e) A `<dbPath>.varlens-recovery.json` sidecar now exists on disk with
    // the expected shape.
    const sidecarPath = recoverySidecarPathFor(dbPath)
    expect(existsSync(sidecarPath)).toBe(true)
    const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8')) as {
      version: number
      passWrap: { saltB64: string; ivB64: string; ctB64: string; tagB64: string }
    }
    expect(sidecar.version).toBe(1)
    expect(typeof sidecar.passWrap.saltB64).toBe('string')
    expect(typeof sidecar.passWrap.ivB64).toBe('string')
    expect(typeof sidecar.passWrap.ctB64).toBe('string')
    expect(typeof sidecar.passWrap.tagB64).toBe('string')
  })

  it('a wrong passphrase against the newly-set recovery wrap is reported as WRONG_PASSWORD, not a corrupted/wrong-key open', async () => {
    const result = setRecoveryPassphrase(PASSPHRASE, () => manager, keyStore)
    expect(result.success).toBe(true)

    const managerB = makeManager('settings-wrong')
    const opened = await openDatabase(
      { path: dbPath, password: 'totally-the-wrong-passphrase' },
      () => managerB.getCurrent(),
      () => managerB,
      noopCallbacks,
      keyStore
    )
    expect(opened).toEqual({ success: false, error: 'WRONG_PASSWORD' })
  })

  it('rejects setting a recovery passphrase on a database with no managed key (explicit password)', async () => {
    const explicitPath = join(tmpDir, 'explicit-password.db')
    const explicitManager = makeManager('settings-explicit')
    const created = await createDatabase(
      { path: explicitPath, password: 'literal-sqlcipher-key' },
      () => explicitManager,
      keyStore
    )
    expect(created.success).toBe(true)

    expect(() => setRecoveryPassphrase('some passphrase', () => explicitManager, keyStore)).toThrow(
      /no managed encryption key/i
    )
  })

  it('rotates a passphrase-only key using the verified DEK from the current open session', async () => {
    await manager.close()
    rmSync(tmpDir, { recursive: true, force: true })

    tmpDir = mkdtempSync(join(tmpdir(), 'varlens-set-recovery-passphrase-only-'))
    dbPath = join(tmpDir, 'case.db')
    manager = new DatabaseManager(new RecentDatabasesService(join(tmpDir, 'settings.json')))
    keyStore = new DbKeyStore({
      registryPath: join(tmpDir, 'keys.json'),
      safeStorage: fakeSafeStorage(false)
    })

    const created = await createDatabase(
      { path: dbPath, setupPassphrase: 'old recovery passphrase' },
      () => manager,
      keyStore
    )
    expect(created.success).toBe(true)

    const result = setRecoveryPassphrase('new recovery passphrase', () => manager, keyStore)
    expect(result).toEqual({ success: true, recoveryPassphraseSet: true, sidecarWritten: true })

    await manager.close()
    const freshStore = new DbKeyStore({
      registryPath: join(tmpDir, 'fresh-keys.json'),
      safeStorage: fakeSafeStorage(false)
    })
    const reopened = makeManager('settings-reopened')
    await expect(
      openDatabase(
        { path: dbPath, password: 'new recovery passphrase' },
        () => reopened.getCurrent(),
        () => reopened,
        noopCallbacks,
        freshStore
      )
    ).resolves.toMatchObject({ success: true })

    const oldPassphraseManager = makeManager('settings-old')
    await expect(
      openDatabase(
        { path: dbPath, password: 'old recovery passphrase' },
        () => oldPassphraseManager.getCurrent(),
        () => oldPassphraseManager,
        noopCallbacks,
        new DbKeyStore({
          registryPath: join(tmpDir, 'old-keys.json'),
          safeStorage: fakeSafeStorage(false)
        })
      )
    ).resolves.toEqual({ success: false, error: 'WRONG_PASSWORD' })
  })
})
