/**
 * The desktop sign-in's `requirePassphrase` switch on the real key-store
 * instance (#295): no new OS wrap, while existing wraps still unwrap, so the
 * open guard keeps recognising databases the computer account alone unlocks.
 */
import { describe, it, expect, vi, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const userData = mkdtempSync(join(tmpdir(), 'varlens-os-wrap-'))
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (text: string) => Buffer.from(`wrapped:${text}`),
    decryptString: (data: Buffer) => data.toString().replace(/^wrapped:/, '')
  }
}))

import {
  getDbKeyStore,
  setOsKeyWrapAllowed
} from '../../../src/main/database/db-key-store-instance'

afterAll(() => {
  setOsKeyWrapAllowed(true)
  rmSync(userData, { recursive: true, force: true })
})

describe('the OS key-wrap switch', () => {
  it('stops new OS wraps and keeps unwrapping the existing ones', () => {
    const keyStore = getDbKeyStore()
    const existing = keyStore.createManagedKey(join(userData, 'existing.db'))
    if (!existing.ok) throw new Error('expected a managed key')

    setOsKeyWrapAllowed(false)
    expect(keyStore.createManagedKey(join(userData, 'new.db'))).toEqual({
      ok: false,
      reason: 'safe-storage-unavailable'
    })
    expect(keyStore.findManagedKeyIdForDek(existing.dek)).toBe(existing.keyId)
    expect(keyStore.resolveKeyForPath(join(userData, 'existing.db')).ok).toBe(true)
  })
})
