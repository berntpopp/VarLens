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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { assertNotHexLiteralKey } from '../../../src/main/database/sqlcipher-key-guard'
import { DbKeyStore, type SafeStorageLike } from '../../../src/main/database/db-key-store'
import { recoverySidecarPathFor } from '../../../src/main/database/recovery-sidecar'

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

  it('keeps migration keys pending until explicitly activated, with legacy/new normal keys active', () => {
    const store = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })
    const dbPath = join(tmpDir, 'migrating.db')

    const pending = store.createPendingManagedKey(dbPath)
    expect(pending.ok).toBe(true)
    if (!pending.ok) throw new Error('expected ok result')

    expect(store.getKeyStateForPath(dbPath)).toBe('pending')
    expect(store.resolveKeyForPath(dbPath)).toMatchObject({ ok: true, dek: pending.dek })

    store.activateKey(pending.keyId)
    expect(store.getKeyStateForPath(dbPath)).toBe('active')

    const raw = JSON.parse(readFileSync(registryPath, 'utf-8'))
    expect(raw.keys[pending.keyId].state).toBe('active')
  })

  it('creates passphrase-only migration keys as pending without changing their recovery semantics', () => {
    const store = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(false) })
    const dbPath = join(tmpDir, 'migrating-passphrase.db')

    const pending = store.wrapNewPendingDekWithPassphrase(dbPath, 'portable secret')
    expect(pending.ok).toBe(true)
    if (!pending.ok) throw new Error('expected ok result')

    expect(pending.sidecarWritten).toBe(true)
    expect(store.getKeyStateForPath(dbPath)).toBe('pending')
    expect(store.resolveKeyWithPassphrase(dbPath, 'portable secret')).toMatchObject({
      ok: true,
      dek: pending.dek
    })
  })

  it('3. createManagedKey reports safe-storage-unavailable (typed result, not a throw) when safeStorage is unavailable', () => {
    const store = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(false) })
    const dbPath = join(tmpDir, 'case.db')

    const result = store.createManagedKey(dbPath)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure result')
    expect(result.reason).toBe('safe-storage-unavailable')
  })

  it('treats Electron basic_text as unavailable and never stores a managed safeWrap', () => {
    const encryptString = vi.fn((s: string) => Buffer.from(`SS:${s}`))
    const store = new DbKeyStore({
      registryPath,
      safeStorage: {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => 'basic_text',
        encryptString,
        decryptString: (b: Buffer) => b.toString().replace(/^SS:/, '')
      }
    })

    const result = store.createManagedKey(join(tmpDir, 'basic-text.db'))

    expect(result).toEqual({ ok: false, reason: 'safe-storage-unavailable' })
    expect(encryptString).not.toHaveBeenCalled()
    expect(existsSync(registryPath)).toBe(false)
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

  it('keeps the registry readable when repointing displaces a stale path entry', () => {
    const store = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })
    const sourcePath = join(tmpDir, 'source.db')
    const destinationPath = join(tmpDir, 'destination.db')
    const moved = store.createManagedKey(sourcePath)
    const stale = store.createManagedKey(destinationPath)
    expect(moved.ok).toBe(true)
    expect(stale.ok).toBe(true)
    if (!moved.ok || !stale.ok) throw new Error('expected managed keys')

    store.updatePath(moved.keyId, destinationPath)

    const freshStore = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })
    expect(freshStore.resolveKeyForPath(destinationPath)).toEqual({ ok: true, dek: moved.dek })
    expect(freshStore.findManagedKeyIdForDek(stale.dek)).toBe(stale.keyId)
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
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error('expected ok result')

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
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error('expected ok result')

    const raw = JSON.parse(readFileSync(registryPath, 'utf-8'))
    expect(raw.keys[created.keyId].safeWrap).toBeUndefined()
    expect(raw.keys[created.keyId].passWrap).toBeDefined()
  })

  it('createManagedKey on an already-keyed path returns path-already-keyed and does not change the resolved DEK', () => {
    const store = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })
    const dbPath = join(tmpDir, 'case.db')

    const original = store.createManagedKey(dbPath)
    expect(original.ok).toBe(true)
    if (!original.ok) throw new Error('expected ok result')

    const second = store.createManagedKey(dbPath)
    expect(second.ok).toBe(false)
    if (second.ok) throw new Error('expected failure result')
    expect(second.reason).toBe('path-already-keyed')

    const resolved = store.resolveKeyForPath(dbPath)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) throw new Error('expected ok result')
    expect(resolved.dek).toBe(original.dek)

    const raw = JSON.parse(readFileSync(registryPath, 'utf-8'))
    expect(raw.pathIndex[dbPath]).toBe(original.keyId)
    expect(Object.keys(raw.keys)).toHaveLength(1)
  })

  it('wrapNewDekWithPassphrase on an already-keyed path returns path-already-keyed and does not orphan the existing key', () => {
    const store = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(false) })
    const dbPath = join(tmpDir, 'case.db')

    const original = store.wrapNewDekWithPassphrase(dbPath, 'hunter2')
    expect(original.ok).toBe(true)
    if (!original.ok) throw new Error('expected ok result')

    const second = store.wrapNewDekWithPassphrase(dbPath, 'different-passphrase')
    expect(second.ok).toBe(false)
    if (second.ok) throw new Error('expected failure result')
    expect(second.reason).toBe('path-already-keyed')

    const resolved = store.resolveKeyWithPassphrase(dbPath, 'hunter2')
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) throw new Error('expected ok result')
    expect(resolved.dek).toBe(original.dek)

    const raw = JSON.parse(readFileSync(registryPath, 'utf-8'))
    expect(raw.pathIndex[dbPath]).toBe(original.keyId)
    expect(Object.keys(raw.keys)).toHaveLength(1)
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

  it('fails closed on a corrupt registry and never overwrites the only key material', () => {
    writeFileSync(registryPath, '{ this is not valid json', 'utf-8')
    const store = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })

    expect(() => store.resolveKeyForPath(join(tmpDir, 'anything.db'))).toThrow(
      'key registry is corrupt or invalid'
    )

    const backup = readFileSync(`${registryPath}.bak`, 'utf-8')
    expect(backup).toBe('{ this is not valid json')

    expect(() => store.createManagedKey(join(tmpDir, 'case.db'))).toThrow(
      'key registry is corrupt or invalid'
    )
    expect(readFileSync(registryPath, 'utf-8')).toBe('{ this is not valid json')
  })

  it('fails closed when registry indexes and key entries are structurally inconsistent', () => {
    const dbPath = join(tmpDir, 'case.db')
    const malformed = JSON.stringify({
      keys: { keyA: { path: dbPath, safeWrap: 'wrapped-key' } },
      pathIndex: { [dbPath]: 'missing-key' }
    })
    writeFileSync(registryPath, malformed, 'utf-8')
    const store = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })

    expect(() => store.createManagedKey(join(tmpDir, 'other.db'))).toThrow(
      'key registry is corrupt or invalid'
    )
    expect(readFileSync(registryPath, 'utf-8')).toBe(malformed)
    expect(readFileSync(`${registryPath}.bak`, 'utf-8')).toBe(malformed)
  })

  describe('recovery sidecar portability', () => {
    it('wrapNewDekWithPassphrase writes a sidecar at <dbPath>.varlens-recovery.json matching the registry passWrap', () => {
      const store = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(false) })
      const dbPath = join(tmpDir, 'case.db')

      const result = store.wrapNewDekWithPassphrase(dbPath, 'hunter2')
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('expected ok result')
      expect(result.sidecarWritten).toBe(true)

      const sidecarPath = recoverySidecarPathFor(dbPath)
      expect(existsSync(sidecarPath)).toBe(true)

      const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8'))
      expect(sidecar.version).toBe(1)

      const raw = JSON.parse(readFileSync(registryPath, 'utf-8'))
      const registryPassWrap = raw.keys[result.keyId].passWrap
      expect(sidecar.passWrap).toEqual(registryPassWrap)
    })

    it('setPassphrase on an existing managed-key entry also writes/overwrites the sidecar at the entry stored path', () => {
      const store = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })
      const dbPath = join(tmpDir, 'case.db')

      const created = store.createManagedKey(dbPath)
      expect(created.ok).toBe(true)
      if (!created.ok) throw new Error('expected ok result')

      const sidecarPath = recoverySidecarPathFor(dbPath)
      expect(existsSync(sidecarPath)).toBe(false)

      const setResult = store.setPassphrase(created.keyId, 'hunter2')
      expect(setResult.ok).toBe(true)
      if (!setResult.ok) throw new Error('expected ok result')
      expect(setResult.sidecarWritten).toBe(true)
      expect(existsSync(sidecarPath)).toBe(true)

      const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8'))
      const raw = JSON.parse(readFileSync(registryPath, 'utf-8'))
      expect(sidecar.passWrap).toEqual(raw.keys[created.keyId].passWrap)

      // A second setPassphrase call overwrites the sidecar with the new wrap.
      const secondSet = store.setPassphrase(created.keyId, 'different-passphrase')
      expect(secondSet.ok).toBe(true)
      const sidecarAfter = JSON.parse(readFileSync(sidecarPath, 'utf-8'))
      const rawAfter = JSON.parse(readFileSync(registryPath, 'utf-8'))
      expect(sidecarAfter.passWrap).toEqual(rawAfter.keys[created.keyId].passWrap)
      expect(sidecarAfter.passWrap).not.toEqual(sidecar.passWrap)
    })

    it('resolveKeyWithPassphraseFromSidecar: correct passphrase resolves the DEK; wrong passphrase returns a typed wrong-passphrase result, never a wrong key', () => {
      const store = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(false) })
      const dbPath = join(tmpDir, 'case.db')

      const created = store.wrapNewDekWithPassphrase(dbPath, 'correct horse battery staple')
      expect(created.ok).toBe(true)
      if (!created.ok) throw new Error('expected ok result')

      const raw = JSON.parse(readFileSync(registryPath, 'utf-8'))
      const passWrap = raw.keys[created.keyId].passWrap

      const correct = store.resolveKeyWithPassphraseFromSidecar(
        passWrap,
        'correct horse battery staple'
      )
      expect(correct.ok).toBe(true)
      if (!correct.ok) throw new Error('expected ok result')
      expect(correct.dek).toBe(created.dek)

      const wrong = store.resolveKeyWithPassphraseFromSidecar(passWrap, 'wrong-passphrase')
      expect(wrong.ok).toBe(false)
      if (wrong.ok) throw new Error('expected failure result')
      expect(wrong.reason).toBe('wrong-passphrase')
    })

    it('enrollRecoveredKey: succeeds on an un-keyed path, mapping a fresh keyId to it with the given passWrap (and a safeWrap too, when safeStorage is available)', () => {
      const store = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })
      const dbPath = join(tmpDir, 'recovered.db')
      const passWrap = {
        saltB64: 'salt',
        ivB64: 'iv',
        ctB64: 'ct',
        tagB64: 'tag'
      }

      const result = store.enrollRecoveredKey(dbPath, 'a'.repeat(64), passWrap)
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('expected ok result')

      const raw = JSON.parse(readFileSync(registryPath, 'utf-8'))
      expect(raw.pathIndex[dbPath]).toBe(result.keyId)
      expect(raw.keys[result.keyId].path).toBe(dbPath)
      expect(raw.keys[result.keyId].passWrap).toEqual(passWrap)
      expect(typeof raw.keys[result.keyId].safeWrap).toBe('string')

      // No sidecar is (re-)written by enrollment -- the passWrap came FROM
      // the sidecar and is already correct and current on disk.
      expect(existsSync(recoverySidecarPathFor(dbPath))).toBe(false)
    })

    it('enrollRecoveredKey: displaces a stale path mapping while preserving its wrapped key', () => {
      const store = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })
      const dbPath = join(tmpDir, 'case.db')
      const original = store.createManagedKey(dbPath)
      expect(original.ok).toBe(true)
      if (!original.ok) throw new Error('expected ok result')

      const result = store.enrollRecoveredKey(dbPath, 'a'.repeat(64), {
        saltB64: 'salt',
        ivB64: 'iv',
        ctB64: 'ct',
        tagB64: 'tag'
      })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('expected success result')

      expect(store.getKeyIdForPath(dbPath)).toBe(result.keyId)
      expect(store.resolveKeyForPath(dbPath)).toEqual({ ok: true, dek: 'a'.repeat(64) })
      expect(store.findManagedKeyIdForDek(original.dek)).toBe(original.keyId)
    })

    it('findManagedKeyIdForDek: returns the matching keyId when a local safeWrap-bearing entry decrypts to that DEK', () => {
      const store = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })
      const dbPath = join(tmpDir, 'case.db')
      const created = store.createManagedKey(dbPath)
      expect(created.ok).toBe(true)
      if (!created.ok) throw new Error('expected ok result')

      const found = store.findManagedKeyIdForDek(created.dek)
      expect(found).toBe(created.keyId)
    })

    it('findManagedKeyIdForDek: returns null when no entry matches', () => {
      const store = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })
      store.createManagedKey(join(tmpDir, 'case.db'))

      expect(store.findManagedKeyIdForDek('nonexistent-dek')).toBeNull()
    })

    it('findManagedKeyIdForDek: returns null when safeStorage is unavailable, even with matching local entries', () => {
      const store = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(false) })
      const dbPath = join(tmpDir, 'case.db')
      const created = store.wrapNewDekWithPassphrase(dbPath, 'hunter2')
      expect(created.ok).toBe(true)
      if (!created.ok) throw new Error('expected ok result')

      // No safeWrap exists at all on a passphrase-only entry, and safeStorage
      // is unavailable regardless -- nothing can match.
      expect(store.findManagedKeyIdForDek(created.dek)).toBeNull()
    })

    it('getKeyIdForPath: returns the mapped keyId, or null for an unknown path', () => {
      const store = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })
      const dbPath = join(tmpDir, 'case.db')
      const created = store.createManagedKey(dbPath)
      expect(created.ok).toBe(true)
      if (!created.ok) throw new Error('expected ok result')

      expect(store.getKeyIdForPath(dbPath)).toBe(created.keyId)
      expect(store.getKeyIdForPath(join(tmpDir, 'never-created.db'))).toBeNull()
    })
  })

  describe('registry write durability (power-loss safety)', () => {
    afterEach(() => {
      vi.doUnmock('fs')
      vi.resetModules()
    })

    it('fsyncs the temp file before the rename, and best-effort fsyncs the directory after it', async () => {
      const calls: string[] = []
      vi.resetModules()
      vi.doMock('fs', async (importOriginal) => {
        const actual = await importOriginal<typeof import('fs')>()
        return {
          ...actual,
          fsyncSync: vi.fn((...args: Parameters<typeof actual.fsyncSync>) => {
            calls.push('fsync')
            return actual.fsyncSync(...args)
          }),
          renameSync: vi.fn((...args: Parameters<typeof actual.renameSync>) => {
            calls.push('rename')
            return actual.renameSync(...args)
          })
        }
      })

      const { DbKeyStore: FreshDbKeyStore } =
        await import('../../../src/main/database/db-key-store')
      const store = new FreshDbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })
      const created = store.createManagedKey(join(tmpDir, 'case.db'))
      expect(created.ok).toBe(true)

      // At least two fsyncs: the temp file (blocking) and the containing
      // directory (best-effort) -- and the file fsync must precede the
      // rename that makes the write visible.
      expect(calls.filter((c) => c === 'fsync').length).toBeGreaterThanOrEqual(2)
      expect(calls[0]).toBe('fsync')
      expect(calls).toContain('rename')
      expect(calls.indexOf('fsync')).toBeLessThan(calls.indexOf('rename'))
    })

    it('a managed key is durably persisted on disk before the caller can proceed to create the database', () => {
      const store = new DbKeyStore({ registryPath, safeStorage: fakeSafeStorage(true) })
      const dbPath = join(tmpDir, 'case.db')

      const created = store.createManagedKey(dbPath)
      expect(created.ok).toBe(true)

      // Synchronous by construction: by the time `createManagedKey` returns,
      // the registry write (including its fsyncs) has already completed, so
      // a fresh read from disk must already see the new key -- a caller that
      // creates the database file next never races ahead of durable key
      // material.
      expect(existsSync(registryPath)).toBe(true)
      const onDisk = JSON.parse(readFileSync(registryPath, 'utf-8')) as {
        pathIndex: Record<string, string>
      }
      expect(onDisk.pathIndex[dbPath]).toBeDefined()
    })
  })
})
