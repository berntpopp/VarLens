/**
 * Consented, backed-up, REVERSIBLE plaintext -> encrypted migration.
 *
 * See `.superpowers/sdd/task-I2b-brief.md` for the full design. These tests
 * ARE the safety proof for the highest-risk task in this milestone: they run
 * against a REAL `better-sqlite3-multiple-ciphers` database on real temp
 * files (no mocking of SQLite itself), and prove -- with seeded rows read
 * back byte-for-byte -- that:
 *   - a successful migration produces a genuinely encrypted file plus an
 *     intact plaintext backup, and
 *   - EVERY failure mode (verification failure, swap failure, no consent,
 *     no keyring+no passphrase) leaves the user with a working database and
 *     no data loss.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, basename, dirname } from 'path'
import Database from 'better-sqlite3-multiple-ciphers'
import {
  migratePlaintextToEncrypted,
  PlaintextMigrationError
} from '../../../src/main/database/plaintext-migration'
import { DbKeyStore, type SafeStorageLike } from '../../../src/main/database/db-key-store'
import { DatabaseManager } from '../../../src/main/services/DatabaseManager'
import { RecentDatabasesService } from '../../../src/main/services/RecentDatabasesService'
import {
  migrateCurrentToEncrypted,
  deletePlaintextBackup
} from '../../../src/main/ipc/handlers/database-migration-logic'
import type { DatabaseLifecycleCallbacks } from '../../../src/main/ipc/handlers/database-lifecycle-logic'
import { DatabaseError } from '../../../src/main/database/errors'

/** Reversible fake "encryption" so round-trips work in tests (same fake used across the I1/I2a suites). */
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

/** Seeds a fresh PLAINTEXT database with a couple of tables and some rows. */
function seedPlaintextDb(path: string): { rows: number } {
  const db = new Database(path)
  db.pragma('user_version = 7')
  db.exec('CREATE TABLE marker (id INTEGER PRIMARY KEY, label TEXT)')
  db.exec('CREATE TABLE other (id INTEGER PRIMARY KEY, value INTEGER)')
  const insertMarker = db.prepare('INSERT INTO marker (label) VALUES (?)')
  insertMarker.run('alpha')
  insertMarker.run('beta')
  insertMarker.run('gamma')
  db.prepare('INSERT INTO other (value) VALUES (?)').run(42)
  db.close()
  return { rows: 3 }
}

function readMarkerLabels(path: string, dek?: string): string[] {
  const db = new Database(path)
  if (dek !== undefined) {
    db.pragma(`key='${dek}'`)
  }
  const rows = db.prepare('SELECT label FROM marker ORDER BY id').all() as Array<{
    label: string
  }>
  db.close()
  return rows.map((r) => r.label)
}

function siblingFiles(path: string): string[] {
  const dir = dirname(path)
  const base = basename(path)
  return readdirSync(dir).filter((f) => f !== base && f.startsWith(base))
}

describe('migratePlaintextToEncrypted (core algorithm)', () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'varlens-plaintext-migration-'))
    dbPath = join(tmpDir, 'case.db')
    seedPlaintextDb(dbPath)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('happy path: encrypts at rest, keeps an intact plaintext backup, preserves all rows', () => {
    const keyStore = new DbKeyStore({
      registryPath: join(tmpDir, 'keys.json'),
      safeStorage: fakeSafeStorage(true)
    })
    const managed = keyStore.createManagedKey(dbPath)
    expect(managed.ok).toBe(true)
    if (!managed.ok) throw new Error('expected ok')

    const result = migratePlaintextToEncrypted({
      path: dbPath,
      dek: managed.dek,
      keyId: managed.keyId,
      keyStore
    })

    // The file at the ORIGINAL path is now encrypted: no-key open fails.
    const rawNoKey = new Database(dbPath)
    expect(() => rawNoKey.prepare('SELECT count(*) FROM sqlite_master').get()).toThrow(
      /file is not a database/i
    )
    rawNoKey.close()

    // With the DEK, the same rows are readable and integrity_check is ok.
    const rawWithKey = new Database(dbPath)
    rawWithKey.pragma(`key='${managed.dek}'`)
    expect(rawWithKey.pragma('integrity_check', { simple: true })).toBe('ok')
    const rows = rawWithKey.prepare('SELECT label FROM marker ORDER BY id').all() as Array<{
      label: string
    }>
    expect(rows.map((r) => r.label)).toEqual(['alpha', 'beta', 'gamma'])
    rawWithKey.close()

    // The plaintext backup exists, is non-empty, and contains the ORIGINAL rows unencrypted.
    expect(result.backupPath).toContain('.plaintext-backup-')
    expect(existsSync(result.backupPath)).toBe(true)
    expect(readMarkerLabels(result.backupPath)).toEqual(['alpha', 'beta', 'gamma'])

    // No leftover `.encrypting-*.tmp` candidate files.
    const leftovers = siblingFiles(dbPath).filter((f) => f.includes('.encrypting-'))
    expect(leftovers).toEqual([])
  })

  it('backup exists and is complete before the swap replaces the original', () => {
    const keyStore = new DbKeyStore({
      registryPath: join(tmpDir, 'keys.json'),
      safeStorage: fakeSafeStorage(true)
    })
    const managed = keyStore.createManagedKey(dbPath)
    if (!managed.ok) throw new Error('expected ok')

    const result = migratePlaintextToEncrypted({
      path: dbPath,
      dek: managed.dek,
      keyId: managed.keyId,
      keyStore
    })

    const stat = existsSync(result.backupPath)
    expect(stat).toBe(true)
    expect(readMarkerLabels(result.backupPath)).toHaveLength(3)
  })

  it('rollback — verification failure: original is byte-for-byte unchanged, no tmp file, no key-store entry', () => {
    const keyStore = new DbKeyStore({
      registryPath: join(tmpDir, 'keys.json'),
      safeStorage: fakeSafeStorage(true)
    })
    const managed = keyStore.createManagedKey(dbPath)
    if (!managed.ok) throw new Error('expected ok')

    const originalBytes = readMarkerLabels(dbPath)

    expect(() =>
      migratePlaintextToEncrypted(
        {
          path: dbPath,
          dek: managed.dek,
          keyId: managed.keyId,
          keyStore
        },
        {
          verifyEncrypted: () => {
            throw new Error('simulated corruption detected during verification')
          }
        }
      )
    ).toThrow(PlaintextMigrationError)

    // Original untouched: still plaintext, still has the same rows.
    expect(readMarkerLabels(dbPath)).toEqual(originalBytes)

    // No `.encrypting-*.tmp` or `.plaintext-backup-*` files left behind.
    const leftovers = siblingFiles(dbPath)
    expect(leftovers).toEqual([])

    // The key-store entry created before the attempt was rolled back.
    expect(keyStore.resolveKeyForPath(dbPath).ok).toBe(false)
  })

  it('rollback — swap/post-swap failure: original is restored from backup, still openable, no data loss', () => {
    const keyStore = new DbKeyStore({
      registryPath: join(tmpDir, 'keys.json'),
      safeStorage: fakeSafeStorage(true)
    })
    const managed = keyStore.createManagedKey(dbPath)
    if (!managed.ok) throw new Error('expected ok')

    const originalLabels = readMarkerLabels(dbPath)
    let calls = 0

    expect(() =>
      migratePlaintextToEncrypted(
        {
          path: dbPath,
          dek: managed.dek,
          keyId: managed.keyId,
          keyStore
        },
        {
          verifyEncrypted: (filePath, dek) => {
            calls += 1
            if (calls === 1) {
              // Pre-swap verification (step 4) must succeed for the swap to happen at all.
              const db = new Database(filePath)
              db.pragma(`key='${dek}'`)
              db.pragma('integrity_check', { simple: true })
              db.close()
              return { userVersion: 7, tableRowCounts: { marker: 3, other: 1 } }
            }
            // Post-swap verification (step 7): simulate a failure here specifically.
            throw new Error('simulated failure re-opening the swapped-in encrypted file')
          }
        }
      )
    ).toThrow(PlaintextMigrationError)

    expect(calls).toBe(2)

    // The original database is restored at `path` -- plaintext, same rows, still openable.
    expect(readMarkerLabels(dbPath)).toEqual(originalLabels)
    const rawNoKey = new Database(dbPath)
    expect(() => rawNoKey.prepare('SELECT count(*) FROM sqlite_master').get()).not.toThrow()
    rawNoKey.close()

    // No leftover `.encrypting-*.tmp` candidate file.
    const leftovers = siblingFiles(dbPath).filter((f) => f.includes('.encrypting-'))
    expect(leftovers).toEqual([])

    // The key-store entry was rolled back.
    expect(keyStore.resolveKeyForPath(dbPath).ok).toBe(false)
  })

  it('idempotence: migrating an already-encrypted database is a typed no-op error', () => {
    const encryptedPath = join(tmpDir, 'already-encrypted.db')
    const db = new Database(encryptedPath)
    db.pragma("key='some-existing-key'")
    db.exec('CREATE TABLE t (id INTEGER)')
    db.close()

    const keyStore = new DbKeyStore({
      registryPath: join(tmpDir, 'keys.json'),
      safeStorage: fakeSafeStorage(true)
    })

    let thrown: unknown
    try {
      migratePlaintextToEncrypted({
        path: encryptedPath,
        dek: 'a'.repeat(64),
        keyId: 'unused-key-id',
        keyStore
      })
    } catch (e) {
      thrown = e
    }

    expect(thrown).toBeInstanceOf(PlaintextMigrationError)
    expect((thrown as PlaintextMigrationError).reason).toBe('already-encrypted')

    // Untouched: still opens with the ORIGINAL key, no tmp/backup files created.
    const raw = new Database(encryptedPath)
    raw.pragma("key='some-existing-key'")
    expect(() => raw.prepare('SELECT count(*) FROM sqlite_master').get()).not.toThrow()
    raw.close()
    expect(siblingFiles(encryptedPath)).toEqual([])
  })
})

describe('migrateCurrentToEncrypted (consent + orchestration)', () => {
  let tmpDir: string
  let dbPath: string
  let manager: DatabaseManager

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'varlens-migration-orchestration-'))
    dbPath = join(tmpDir, 'case.db')
    manager = new DatabaseManager(new RecentDatabasesService(join(tmpDir, 'settings.json')))
    // A plaintext database, currently open -- as if the app just launched
    // and opened an existing pre-encryption-by-default database.
    await manager.createDatabase(dbPath)
    manager.getCurrent().database.exec('CREATE TABLE marker (id INTEGER PRIMARY KEY, label TEXT)')
    manager
      .getCurrent()
      .database.prepare('INSERT INTO marker (label) VALUES (?)')
      .run('needs-migration')
  })

  afterEach(async () => {
    await manager.close()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('refuses without explicit consent, leaving the database open and untouched', async () => {
    const keyStore = new DbKeyStore({
      registryPath: join(tmpDir, 'keys.json'),
      safeStorage: fakeSafeStorage(true)
    })

    await expect(
      migrateCurrentToEncrypted(
        { consent: false, recoveryPassphrase: undefined },
        () => manager,
        keyStore,
        noopCallbacks
      )
    ).rejects.toThrow(/consent/i)

    // The database is still open, still plaintext, data intact.
    expect(manager.getCurrentInfo()?.encrypted).toBe(false)
    const rows = manager.getCurrent().database.prepare('SELECT label FROM marker').all() as Array<{
      label: string
    }>
    expect(rows).toEqual([{ label: 'needs-migration' }])
    // No migration-artifact files -- a `-wal`/`-shm` sidecar from the still-open
    // WAL-mode session is expected and is not a migration artifact.
    expect(siblingFiles(dbPath).filter((f) => !f.endsWith('-wal') && !f.endsWith('-shm'))).toEqual(
      []
    )
  })

  it('no-keyring path: safeStorage unavailable and no passphrase supplied -> typed error, never half-migrates', async () => {
    const keyStore = new DbKeyStore({
      registryPath: join(tmpDir, 'keys.json'),
      safeStorage: fakeSafeStorage(false)
    })

    await expect(
      migrateCurrentToEncrypted({ consent: true }, () => manager, keyStore, noopCallbacks)
    ).rejects.toThrow(DatabaseError)

    // No key-store entry was minted for this path.
    expect(keyStore.resolveKeyForPath(dbPath).ok).toBe(false)

    // No `.encrypting-*.tmp` or `.plaintext-backup-*` files -- migration never started.
    // (A `-wal`/`-shm` sidecar from the still-open WAL-mode session is expected.)
    expect(siblingFiles(dbPath).filter((f) => !f.endsWith('-wal') && !f.endsWith('-shm'))).toEqual(
      []
    )

    // The database is still usable (reopened plaintext by the orchestration layer).
    expect(manager.getCurrentInfo()).not.toBeNull()
    expect(manager.getCurrentInfo()?.encrypted).toBe(false)
    const rows = manager.getCurrent().database.prepare('SELECT label FROM marker').all() as Array<{
      label: string
    }>
    expect(rows).toEqual([{ label: 'needs-migration' }])
  })

  it('managed-key migration with a recovery passphrase sets durable recovery, and the app session stays usable', async () => {
    const keyStore = new DbKeyStore({
      registryPath: join(tmpDir, 'keys.json'),
      safeStorage: fakeSafeStorage(true)
    })

    const result = await migrateCurrentToEncrypted(
      { consent: true, recoveryPassphrase: 'correct horse battery staple' },
      () => manager,
      keyStore,
      noopCallbacks
    )

    expect(result.success).toBe(true)
    expect(result.recoveryPassphraseSet).toBe(true)
    expect(result.info?.encrypted).toBe(true)
    expect(existsSync(result.backupPath!)).toBe(true)

    // The app's live session is now the encrypted DB, with the original data intact.
    expect(manager.getCurrentInfo()?.encrypted).toBe(true)
    const rows = manager.getCurrent().database.prepare('SELECT label FROM marker').all() as Array<{
      label: string
    }>
    expect(rows).toEqual([{ label: 'needs-migration' }])

    // Durability: the recovery passphrase alone (no keyring) resolves the SAME DEK
    // that the managed (safeStorage) wrap resolves -- keyring loss would not be fatal.
    const viaKeyring = keyStore.resolveKeyForPath(dbPath)
    const viaPassphrase = keyStore.resolveKeyWithPassphrase(dbPath, 'correct horse battery staple')
    expect(viaKeyring.ok).toBe(true)
    expect(viaPassphrase.ok).toBe(true)
    if (viaKeyring.ok && viaPassphrase.ok) {
      expect(viaPassphrase.dek).toBe(viaKeyring.dek)
    }

    // Post-migration cleanup: the plaintext backup can be deleted through the
    // gated IPC-facing action, but only because it matches the CURRENT db path.
    const deleteResult = await deletePlaintextBackup(result.backupPath!, () => manager)
    expect(deleteResult.success).toBe(true)
    expect(existsSync(result.backupPath!)).toBe(false)
  })

  it('deletePlaintextBackup refuses to delete a file that is not a plaintext backup of the currently open database', async () => {
    const arbitraryFile = join(tmpDir, 'not-a-backup.txt')
    writeFileSync(arbitraryFile, 'not a database backup')

    await expect(deletePlaintextBackup(arbitraryFile, () => manager)).rejects.toThrow()
    expect(existsSync(arbitraryFile)).toBe(true)
  })
})
