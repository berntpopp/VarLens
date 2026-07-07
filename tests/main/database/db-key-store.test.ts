/**
 * DbKeyStore — envelope-encryption key-lifecycle store tests
 *
 * Covers the 8 required scenarios from the task brief:
 * 1. DEK format (64 hex chars, never starts with x/X, passes assertNotHexLiteralKey)
 * 2. Transparent round-trip via safeStorage
 * 3. safeStorage unavailable → typed failure result
 * 4. Passphrase wrap round-trip + wrong-passphrase typed failure
 * 5. Move/rename path mapping
 * 6. Portability: passphrase-only DEK resolves with safeStorage unavailable
 * 7. removeKey deletes both keyId entry and path mapping
 * 8. Registry persistence across store instances reading the same file
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { assertNotHexLiteralKey } from '../../../src/main/database/sqlcipher-key-guard'
import { DbKeyStore, type SafeStorageLike } from '../../../src/main/database/db-key-store'

/** Reversible fake "encryption" so round-trips work in tests. */
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

describe('DbKeyStore', () => {
  let tmpDir: string
  let registryPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'varlens-keystore-'))
    registryPath = join(tmpDir, 'varlens-db-keys.json')
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('1. createManagedKey returns a 64-hex-char DEK that never starts with x/X and passes assertNotHexLiteralKey; registry gains a keyId with a safeWrap mapped to the path', () => {
    const store = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })
    const dbPath = join(tmpDir, 'case.db')

    const result = store.createManagedKey(dbPath)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.dek).toMatch(/^[0-9a-f]{64}$/)
    expect(result.dek.startsWith('x')).toBe(false)
    expect(result.dek.startsWith('X')).toBe(false)
    expect(() => assertNotHexLiteralKey(result.dek)).not.toThrow()

    const raw = JSON.parse(readFileSync(registryPath, 'utf-8'))
    expect(raw.keys[result.keyId]).toBeDefined()
    expect(raw.keys[result.keyId].path).toBe(dbPath)
    expect(typeof raw.keys[result.keyId].safeWrap).toBe('string')
    expect(raw.pathIndex[dbPath]).toBe(result.keyId)
  })

  it('2. resolveKeyForPath returns the SAME DEK after createManagedKey (transparent round-trip)', () => {
    const store = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })
    const dbPath = join(tmpDir, 'case.db')

    const created = store.createManagedKey(dbPath)
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error('expected ok result')

    const resolved = store.resolveKeyForPath(dbPath)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) throw new Error('expected ok result')
    expect(resolved.dek).toBe(created.dek)
  })

  it('3. createManagedKey reports safe-storage-unavailable (typed result, not a throw) when safeStorage is unavailable', () => {
    const store = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(false) })
    const dbPath = join(tmpDir, 'case.db')

    const result = store.createManagedKey(dbPath)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure result')
    expect(result.reason).toBe('safe-storage-unavailable')
  })

  it('4a. setPassphrase + resolveKeyWithPassphrase returns the SAME DEK', () => {
    const store = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })
    const dbPath = join(tmpDir, 'case.db')

    const created = store.createManagedKey(dbPath)
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error('expected ok result')

    const setResult = store.setPassphrase(created.keyId, 'hunter2')
    expect(setResult.ok).toBe(true)

    const resolved = store.resolveKeyWithPassphrase(dbPath, 'hunter2')
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) throw new Error('expected ok result')
    expect(resolved.dek).toBe(created.dek)
  })

  it('4b. resolveKeyWithPassphrase with a wrong passphrase returns a typed wrong-passphrase result, NOT the wrong key', () => {
    const store = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })
    const dbPath = join(tmpDir, 'case.db')

    const created = store.createManagedKey(dbPath)
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error('expected ok result')
    store.setPassphrase(created.keyId, 'hunter2')

    const resolved = store.resolveKeyWithPassphrase(dbPath, 'wrong-passphrase')

    expect(resolved.ok).toBe(false)
    if (resolved.ok) throw new Error('expected failure result')
    expect(resolved.reason).toBe('wrong-passphrase')
  })

  it('5. updatePath makes resolveKeyForPath(newPath) work; the old path miss returns a typed miss, never a wrong key', () => {
    const store = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })
    const oldPath = join(tmpDir, 'case-old.db')
    const newPath = join(tmpDir, 'case-new.db')

    const created = store.createManagedKey(oldPath)
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error('expected ok result')

    store.updatePath(created.keyId, newPath)

    const resolvedNew = store.resolveKeyForPath(newPath)
    expect(resolvedNew.ok).toBe(true)
    if (!resolvedNew.ok) throw new Error('expected ok result')
    expect(resolvedNew.dek).toBe(created.dek)

    const resolvedOld = store.resolveKeyForPath(oldPath)
    expect(resolvedOld.ok).toBe(false)
    if (resolvedOld.ok) throw new Error('expected failure result')
    expect(['not-found', 'needs-passphrase']).toContain(resolvedOld.reason)
  })

  it('resolveKeyForPath on a totally unknown path returns not-found', () => {
    const store = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })
    const resolved = store.resolveKeyForPath(join(tmpDir, 'never-created.db'))
    expect(resolved.ok).toBe(false)
    if (resolved.ok) throw new Error('expected failure result')
    expect(resolved.reason).toBe('not-found')
  })

  it('6. Portability: a passphrase-wrapped DEK resolves with the passphrase even when safeStorage is unavailable on another "machine"', () => {
    const dbPath = join(tmpDir, 'case.db')

    // "Machine A": no keyring available, so the no-keyring create path is used.
    const storeA = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(false) })
    const created = storeA.wrapNewDekWithPassphrase(dbPath, 'correct horse battery staple')

    // "Machine B": a fresh store instance over the SAME registry file, safeStorage also unavailable.
    const storeB = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(false) })
    const resolved = storeB.resolveKeyWithPassphrase(dbPath, 'correct horse battery staple')

    expect(resolved.ok).toBe(true)
    if (!resolved.ok) throw new Error('expected ok result')
    expect(resolved.dek).toBe(created.dek)
  })

  it('wrapNewDekWithPassphrase stores ONLY a passphrase wrap (no safeWrap)', () => {
    const store = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })
    const dbPath = join(tmpDir, 'case.db')

    const created = store.wrapNewDekWithPassphrase(dbPath, 'hunter2')

    const raw = JSON.parse(readFileSync(registryPath, 'utf-8'))
    expect(raw.keys[created.keyId].safeWrap).toBeUndefined()
    expect(raw.keys[created.keyId].passWrap).toBeDefined()
  })

  it('7. removeKey deletes both the keyId entry and the path mapping', () => {
    const store = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })
    const dbPath = join(tmpDir, 'case.db')

    const created = store.createManagedKey(dbPath)
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error('expected ok result')

    store.removeKey(created.keyId)

    const raw = JSON.parse(readFileSync(registryPath, 'utf-8'))
    expect(raw.keys[created.keyId]).toBeUndefined()
    expect(raw.pathIndex[dbPath]).toBeUndefined()

    const resolved = store.resolveKeyForPath(dbPath)
    expect(resolved.ok).toBe(false)
  })

  it('8. Registry persistence: a second store instance reading the same file sees prior entries', () => {
    const dbPath = join(tmpDir, 'case.db')
    const store1 = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })
    const created = store1.createManagedKey(dbPath)
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error('expected ok result')

    const store2 = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })
    const resolved = store2.resolveKeyForPath(dbPath)

    expect(resolved.ok).toBe(true)
    if (!resolved.ok) throw new Error('expected ok result')
    expect(resolved.dek).toBe(created.dek)
  })

  it('tolerates a missing registry file (treats as empty)', () => {
    const store = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })
    const resolved = store.resolveKeyForPath(join(tmpDir, 'anything.db'))
    expect(resolved.ok).toBe(false)
  })

  it('tolerates a corrupt registry file: logs, treats as empty, and preserves a .bak backup', () => {
    writeFileSync(registryPath, '{ this is not valid json', 'utf-8')
    const store = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })

    const resolved = store.resolveKeyForPath(join(tmpDir, 'anything.db'))
    expect(resolved.ok).toBe(false)

    const backup = readFileSync(`${registryPath}.bak`, 'utf-8')
    expect(backup).toBe('{ this is not valid json')

    // The store must still be usable after encountering a corrupt file.
    const created = store.createManagedKey(join(tmpDir, 'case.db'))
    expect(created.ok).toBe(true)
  })
})
