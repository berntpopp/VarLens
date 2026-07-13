/**
 * End-to-end proof of the recovery-sidecar fix: a passphrase-wrapped DEK must
 * be portable when the `.db` file is copied to a brand-new machine/path
 * ALONGSIDE its `<dbPath>.varlens-recovery.json` sidecar -- even though the
 * `DbKeyStore` registry (which lives in `userData`, outside the database
 * file) never travels with the copy.
 *
 * These tests run against REAL `better-sqlite3-multiple-ciphers` files on
 * disk, a REAL `DbKeyStore`, and the REAL `openDatabase`/`createDatabase`
 * orchestration from `database-lifecycle-logic.ts` -- no mocking of SQLite
 * or the key-store crypto itself.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, copyFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DbKeyStore, type SafeStorageLike } from '../../../src/main/database/db-key-store'
import { recoverySidecarPathFor } from '../../../src/main/database/recovery-sidecar'
import { DatabaseManager } from '../../../src/main/services/DatabaseManager'
import { RecentDatabasesService } from '../../../src/main/services/RecentDatabasesService'
import {
  createDatabase,
  openDatabase,
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

describe('recovery sidecar portability (openDatabase end-to-end)', () => {
  const tmpDirs: string[] = []
  const managers: DatabaseManager[] = []

  function makeTmpDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix))
    tmpDirs.push(dir)
    return dir
  }

  function makeManager(dir: string, label: string): DatabaseManager {
    const manager = new DatabaseManager(new RecentDatabasesService(join(dir, `${label}.json`)))
    managers.push(manager)
    return manager
  }

  afterEach(async () => {
    await Promise.all(managers.map((m) => m.close()))
    managers.length = 0
    for (const dir of tmpDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tmpDirs.length = 0
  })

  it('a database copied to a brand-new path/machine, WITH its recovery sidecar, opens with the correct passphrase and reads back the original rows unchanged', async () => {
    // "Machine A": no keyring -- the create flow falls back to needsPassphraseSetup,
    // and the follow-up setupPassphrase call wraps a fresh DEK with the passphrase.
    const dirA = makeTmpDir('varlens-recovery-origin-')
    const originalPath = join(dirA, 'case.db')
    const keyStoreA = new DbKeyStore({
      registryPath: join(dirA, 'keys.json'),
      safeStorage: fakeSafeStorage(false)
    })
    const managerA = makeManager(dirA, 'settings')

    const attempt = await createDatabase({ path: originalPath }, () => managerA, keyStoreA)
    expect(attempt).toEqual({ success: false, needsPassphraseSetup: true })

    const created = await createDatabase(
      { path: originalPath, setupPassphrase: PASSPHRASE },
      () => managerA,
      keyStoreA
    )
    expect(created.success).toBe(true)

    managerA.getCurrent().database.exec('CREATE TABLE marker (id INTEGER PRIMARY KEY, label TEXT)')
    managerA
      .getCurrent()
      .database.prepare('INSERT INTO marker (label) VALUES (?)')
      .run('portable-row')
    await managerA.close()

    // Copy BOTH the .db file AND its sidecar to a brand-new path in a
    // brand-new directory -- the registry (keys.json) deliberately does NOT
    // travel, simulating a new machine (or a wiped userData directory).
    const dirB = makeTmpDir('varlens-recovery-destination-')
    const newPath = join(dirB, 'moved-case.db')
    copyFileSync(originalPath, newPath)
    copyFileSync(recoverySidecarPathFor(originalPath), recoverySidecarPathFor(newPath))

    const keyStoreB = new DbKeyStore({
      registryPath: join(dirB, 'keys.json'),
      safeStorage: fakeSafeStorage(false)
    })
    const managerB = makeManager(dirB, 'settings')

    // The initial no-password detection call must still prompt for a
    // password -- a sidecar alone (without a passphrase) is never enough.
    const detected = await openDatabase(
      { path: newPath },
      () => managerB.getCurrent(),
      () => managerB,
      noopCallbacks,
      keyStoreB
    )
    expect(detected).toEqual({ success: false, needsPassword: true })

    const opened = await openDatabase(
      { path: newPath, password: PASSPHRASE },
      () => managerB.getCurrent(),
      () => managerB,
      noopCallbacks,
      keyStoreB
    )
    expect(opened.success).toBe(true)

    const rows = managerB.getCurrent().database.prepare('SELECT label FROM marker').all() as Array<{
      label: string
    }>
    expect(rows).toEqual([{ label: 'portable-row' }])

    // Enrollment happened: the fresh registry now has an entry for the new
    // path, so future opens on THIS machine are transparent.
    const registryRaw = JSON.parse(readFileSync(join(dirB, 'keys.json'), 'utf-8'))
    expect(registryRaw.pathIndex[newPath]).toBeDefined()
    const enrolledKeyId = registryRaw.pathIndex[newPath]
    expect(registryRaw.keys[enrolledKeyId].path).toBe(newPath)
    expect(registryRaw.keys[enrolledKeyId].passWrap).toBeDefined()
  })

  it('a wrong passphrase against the sidecar-only copy is reported as WRONG_PASSWORD -- never a corrupted or wrong-key open', async () => {
    const dirA = makeTmpDir('varlens-recovery-origin-')
    const originalPath = join(dirA, 'case.db')
    const keyStoreA = new DbKeyStore({
      registryPath: join(dirA, 'keys.json'),
      safeStorage: fakeSafeStorage(false)
    })
    const managerA = makeManager(dirA, 'settings')

    await createDatabase(
      { path: originalPath, setupPassphrase: PASSPHRASE },
      () => managerA,
      keyStoreA
    )
    managerA.getCurrent().database.exec('CREATE TABLE marker (id INTEGER PRIMARY KEY)')
    await managerA.close()

    const dirB = makeTmpDir('varlens-recovery-destination-')
    const newPath = join(dirB, 'moved-case.db')
    copyFileSync(originalPath, newPath)
    copyFileSync(recoverySidecarPathFor(originalPath), recoverySidecarPathFor(newPath))

    const keyStoreB = new DbKeyStore({
      registryPath: join(dirB, 'keys.json'),
      safeStorage: fakeSafeStorage(false)
    })
    const managerB = makeManager(dirB, 'settings')

    const opened = await openDatabase(
      { path: newPath, password: 'totally-the-wrong-passphrase' },
      () => managerB.getCurrent(),
      () => managerB,
      noopCallbacks,
      keyStoreB
    )
    expect(opened).toEqual({ success: false, error: 'WRONG_PASSWORD' })

    // No database session was opened, and no registry entry was minted for
    // a recovery that never actually succeeded.
    expect(managerB.getCurrentInfo()).toBeNull()
    expect(keyStoreB.getKeyIdForPath(newPath)).toBeNull()
  })

  it('a valid but mismatched copied sidecar cannot mutate the registry before SQLite rejects its DEK', async () => {
    const dir = makeTmpDir('varlens-recovery-mismatch-')
    const sourcePath = join(dir, 'source.db')
    const targetPath = join(dir, 'target.db')
    const registryPath = join(dir, 'keys.json')
    const keyStore = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })
    const sourceManager = makeManager(dir, 'source-settings')
    const targetManager = makeManager(dir, 'target-settings')

    await createDatabase({ path: sourcePath }, () => sourceManager, keyStore)
    const sourceKeyId = keyStore.getKeyIdForPath(sourcePath)
    expect(sourceKeyId).not.toBeNull()
    if (sourceKeyId === null) throw new Error('expected source key')
    expect(keyStore.setPassphrase(sourceKeyId, PASSPHRASE)).toMatchObject({ ok: true })
    await sourceManager.close()

    await createDatabase(
      { path: targetPath, password: 'target-raw-sqlcipher-key' },
      () => targetManager,
      keyStore
    )
    targetManager.getCurrent().database.exec('CREATE TABLE target_marker (id INTEGER PRIMARY KEY)')
    await targetManager.close()

    copyFileSync(recoverySidecarPathFor(sourcePath), recoverySidecarPathFor(targetPath))
    const registryBefore = readFileSync(registryPath)

    const opened = await openDatabase(
      { path: targetPath, password: PASSPHRASE },
      () => targetManager.getCurrent(),
      () => targetManager,
      noopCallbacks,
      keyStore
    )

    expect(opened).toEqual({ success: false, error: 'WRONG_PASSWORD' })
    expect(readFileSync(registryPath)).toEqual(registryBefore)
    expect(keyStore.getKeyIdForPath(sourcePath)).toBe(sourceKeyId)
    expect(keyStore.getKeyIdForPath(targetPath)).toBeNull()
  })

  it('tries a verified sidecar candidate when a stale path registry wrap accepts the same passphrase', async () => {
    const dir = makeTmpDir('varlens-recovery-stale-registry-')
    const registryPath = join(dir, 'keys.json')
    const stalePath = join(dir, 'restored.db')
    const replacementPath = join(dir, 'replacement.db')
    const keyStore = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })
    const staleManager = makeManager(dir, 'stale-settings')
    const replacementManager = makeManager(dir, 'replacement-settings')

    await createDatabase({ path: stalePath }, () => staleManager, keyStore)
    const staleKeyId = keyStore.getKeyIdForPath(stalePath)
    expect(staleKeyId).not.toBeNull()
    if (staleKeyId === null) throw new Error('expected stale managed key')
    expect(keyStore.setPassphrase(staleKeyId, PASSPHRASE)).toMatchObject({ ok: true })
    await staleManager.close()

    await createDatabase({ path: replacementPath }, () => replacementManager, keyStore)
    const replacementKeyId = keyStore.getKeyIdForPath(replacementPath)
    expect(replacementKeyId).not.toBeNull()
    if (replacementKeyId === null) throw new Error('expected replacement managed key')
    const replacementResolved = keyStore.resolveKeyForPath(replacementPath)
    expect(replacementResolved.ok).toBe(true)
    expect(keyStore.setPassphrase(replacementKeyId, PASSPHRASE)).toMatchObject({ ok: true })
    replacementManager
      .getCurrent()
      .database.exec('CREATE TABLE restored_marker (label TEXT NOT NULL)')
    replacementManager
      .getCurrent()
      .database.prepare('INSERT INTO restored_marker (label) VALUES (?)')
      .run('replacement-data')
    await replacementManager.close()

    // Simulate restoring/copying a different managed database and its valid
    // recovery sidecar over a path whose old registry entry still exists.
    // Reusing the same passphrase is deliberately realistic: the stale
    // registry wrap authenticates successfully, but yields the wrong DEK.
    copyFileSync(replacementPath, stalePath)
    copyFileSync(recoverySidecarPathFor(replacementPath), recoverySidecarPathFor(stalePath))

    const opened = await openDatabase(
      { path: stalePath, password: PASSPHRASE },
      () => staleManager.getCurrent(),
      () => staleManager,
      noopCallbacks,
      keyStore
    )

    expect(opened.success).toBe(true)
    expect(
      staleManager.getCurrent().database.prepare('SELECT label FROM restored_marker').pluck().all()
    ).toEqual(['replacement-data'])
    expect(keyStore.getKeyIdForPath(stalePath)).toBe(replacementKeyId)
    expect(keyStore.resolveKeyForPath(stalePath)).toEqual(replacementResolved)
    expect(keyStore.resolveKeyForPath(replacementPath)).toEqual({ ok: false, reason: 'not-found' })
  })
})
