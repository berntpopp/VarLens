/**
 * The desktop sign-in's data rules (#295) against a real DatabaseManager
 * and DbKeyStore (only safeStorage is faked): binding to the signed-in
 * identity (issuer and subject), passphrase-only databases, and the lock that
 * drops the key.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DbKeyStore, type SafeStorageLike } from '../../../src/main/database/db-key-store'
import { wrapPassphrase } from '../../../src/main/database/db-key-passphrase'
import { ForbiddenError } from '../../../src/main/ipc/errors'
import { trackDatabaseWorker } from '../../../src/main/services/jobs/database-activity'
import { DatabaseManager } from '../../../src/main/services/DatabaseManager'
import { RecentDatabasesService } from '../../../src/main/services/RecentDatabasesService'
import { createDatabase } from '../../../src/main/ipc/handlers/database-logic'
import { migrateCurrentToEncrypted } from '../../../src/main/ipc/handlers/database-migration-logic'
import { platformIdentity, platformOpenGuard } from '../../../src/main/auth/database-binding'
import { ErrorCode } from '../../../src/shared/types/errors'
import type { StorageSession } from '../../../src/main/storage/session'
import { SqliteStorageSession } from '../../../src/main/storage/sqlite/SqliteStorageSession'

/** Like db-key-store-instance: with `osWrap` off, new wraps fail and old ones still unwrap. */
const keyring = { osWrap: true }
function fakeSafeStorage(): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => {
      if (!keyring.osWrap) throw new Error('this computer requires passphrase-protected databases')
      return Buffer.from('SS:' + s)
    },
    decryptString: (b: Buffer) => b.toString().replace(/^SS:/, '')
  }
}

const noopCallbacks = { triggerStartupRebuild: () => undefined }
const ISSUER = 'https://idp.example.org/realms/varlens'

describe('desktop sign-in data rules', () => {
  let dir: string
  let manager: DatabaseManager
  let recent: RecentDatabasesService
  let keyStore: DbKeyStore
  let subject: string | undefined

  function guard(requirePassphrase = false): void {
    manager.setOpenGuard(
      platformOpenGuard({
        identity: () => (subject === undefined ? undefined : platformIdentity(ISSUER, subject)),
        requirePassphrase,
        osUnlockable: (key) => keyStore.findManagedKeyIdForDek(key) !== null
      })
    )
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-binding-'))
    recent = new RecentDatabasesService(join(dir, 'settings.json'))
    manager = new DatabaseManager(recent)
    keyStore = new DbKeyStore({
      registryPath: join(dir, 'keys.json'),
      safeStorage: fakeSafeStorage()
    })
    subject = 'subject-a'
  })

  afterEach(async () => {
    keyring.osWrap = true
    await manager.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('binds a database to the first account and refuses every other', async () => {
    guard()
    const path = join(dir, 'a.db')
    expect((await createDatabase({ path }, () => manager, keyStore)).success).toBe(true)
    expect(manager.getCurrent().auth.platformIdentity()).toBe(platformIdentity(ISSUER, 'subject-a'))
    await manager.close()

    subject = 'subject-b'
    const key = keyStore.resolveKeyForPath(path)
    if (!key.ok) throw new Error('expected a managed key')
    const addRecent = vi.spyOn(recent, 'addRecent')
    const closeForLock = vi.spyOn(SqliteStorageSession.prototype, 'closeForLock')
    const refused = manager.open(path, key.dek)
    await expect(refused).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      userMessage: expect.stringMatching(/another account/)
    })
    expect(manager.getCurrentPath()).toBeNull()
    expect(addRecent).not.toHaveBeenCalled()
    // The refused session is closed with its key dropped.
    expect(closeForLock).toHaveBeenCalledOnce()
    addRecent.mockRestore()
    closeForLock.mockRestore()

    subject = 'subject-a'
    await manager.open(path, key.dek)
    expect(manager.getCurrentPath()).toBe(path)
  })

  it('restores the previous database when a switch is refused', async () => {
    guard()
    const first = join(dir, 'first.db')
    const second = join(dir, 'second.db')
    await createDatabase({ path: second }, () => manager, keyStore)
    await manager.close()
    subject = 'subject-b'
    await createDatabase({ path: first }, () => manager, keyStore)
    const key = keyStore.resolveKeyForPath(second)
    if (!key.ok) throw new Error('expected a managed key')
    await expect(manager.switchDatabase(second, key.dek)).rejects.toBeInstanceOf(ForbiddenError)
    expect(manager.getCurrentPath()).toBe(first)
  })

  it('opens nothing while nobody is signed in', async () => {
    guard()
    subject = undefined
    const result = createDatabase({ path: join(dir, 'x.db') }, () => manager, keyStore)
    await expect(result).rejects.toMatchObject({ code: ErrorCode.UNAUTHENTICATED })
  })

  it('treats the same subject from another issuer as another account', async () => {
    guard()
    const path = join(dir, 'issuer.db')
    await createDatabase({ path }, () => manager, keyStore)
    await manager.close()
    manager.setOpenGuard(
      platformOpenGuard({
        identity: () => platformIdentity('https://other.example.org', 'subject-a'),
        requirePassphrase: false,
        osUnlockable: () => false
      })
    )
    const key = keyStore.resolveKeyForPath(path)
    if (!key.ok) throw new Error('expected a managed key')
    await expect(manager.open(path, key.dek)).rejects.toThrow(/another account/)
  })

  it('refuses a Postgres workspace in platform mode and keeps the open database', async () => {
    guard()
    const open = join(dir, 'kept.db')
    await createDatabase({ path: open }, () => manager, keyStore)
    const session = {
      workspace: { kind: 'postgres' },
      capabilities: { backend: 'postgres' },
      close: async () => undefined
    } as unknown as StorageSession
    await expect(manager.openPostgresSession(session)).rejects.toBeInstanceOf(ForbiddenError)
    expect(manager.getCurrentPath()).toBe(open)
  })

  describe('with requirePassphrase', () => {
    it('creates new databases only with a passphrase, and opens them', async () => {
      keyring.osWrap = false
      guard(true)
      const path = join(dir, 'p.db')
      expect(await createDatabase({ path }, () => manager, keyStore)).toEqual({
        success: false,
        needsPassphraseSetup: true
      })
      const created = await createDatabase(
        { path, setupPassphrase: 'correct horse battery staple' },
        () => manager,
        keyStore
      )
      expect(created.success).toBe(true)
      expect(keyStore.resolveKeyForPath(path).ok).toBe(false)
    })

    it('refuses a database the computer account alone unlocks, and a plaintext one', async () => {
      const managed = join(dir, 'managed.db')
      await createDatabase({ path: managed }, () => manager, keyStore)
      await manager.close()
      const plaintext = join(dir, 'plain.db')
      await manager.createDatabase(plaintext)
      await manager.close()

      keyring.osWrap = false
      guard(true)
      const key = keyStore.resolveKeyForPath(managed)
      if (!key.ok) throw new Error('expected a managed key')
      await expect(manager.open(managed, key.dek)).rejects.toThrow(/passphrase/)
      await expect(manager.open(plaintext)).rejects.toThrow(/passphrase/)
    })

    it('migrates a plaintext database only with a passphrase, to a passphrase-only key', async () => {
      const path = join(dir, 'migrate.db')
      await manager.createDatabase(path)
      keyring.osWrap = false
      await expect(
        migrateCurrentToEncrypted({ consent: true }, () => manager, keyStore, noopCallbacks)
      ).rejects.toThrow(/no recovery passphrase/)
      expect(keyStore.resolveKeyForPath(path).ok).toBe(false)
      const migrated = await migrateCurrentToEncrypted(
        { consent: true, recoveryPassphrase: 'correct horse battery staple' },
        () => manager,
        keyStore,
        noopCallbacks
      )
      expect(migrated).toMatchObject({ success: true })
      expect(keyStore.resolveKeyForPath(path).ok).toBe(false)
      // The guard accepts the passphrase-only key it now opens with.
      await manager.close()
      guard(true)
      const resolved = keyStore.resolveKeyWithPassphrase(path, 'correct horse battery staple')
      if (!resolved.ok) throw new Error('expected the passphrase to open it')
      await manager.open(path, resolved.dek)
      expect(manager.getCurrentPath()).toBe(path)
    })

    it('gives a key recovered from its sidecar no OS wrap', () => {
      const path = join(dir, 'recovered.db')
      const dek = 'ab'.repeat(32)
      keyring.osWrap = false
      const enrolled = keyStore.enrollRecoveredKey(path, dek, wrapPassphrase(dek, 'passphrase'))
      expect(enrolled.ok).toBe(true)
      expect(keyStore.resolveKeyForPath(path).ok).toBe(false)
      expect(keyStore.findManagedKeyIdForDek(dek)).toBeNull()
    })
  })

  it('locks: closes the database and drops the key copy', async () => {
    guard()
    const path = join(dir, 'l.db')
    await createDatabase({ path }, () => manager, keyStore)
    const service = manager.getCurrent()
    expect(service.getEncryptionKey()).toBeDefined()
    await expect(manager.lock()).resolves.toBe(true)
    expect(manager.getCurrentPath()).toBeNull()
    expect(service.getEncryptionKey()).toBeUndefined()
  })

  it('closes nothing while work runs against the database', async () => {
    guard()
    const path = join(dir, 'busy.db')
    await createDatabase({ path }, () => manager, keyStore)
    let finish: () => void = () => undefined
    const work = trackDatabaseWorker('rebuild', new Promise<void>((r) => (finish = r)))
    await expect(manager.lock()).resolves.toBe(false)
    expect(manager.getCurrentPath()).toBe(path)
    finish()
    await work
    await expect(manager.lock()).resolves.toBe(true)
  })
})
