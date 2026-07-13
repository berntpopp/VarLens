/**
 * Lazily-constructed `DbKeyStore` singleton, scoped to Electron's userData
 * directory and backed by the real OS keyring via `safeStorage`.
 *
 * Kept as its own module (rather than inlined in the IPC handler layer, next
 * to `getDefaultPostgresProfileStore`'s pattern in `handlers/database.ts`)
 * so main-process code that would otherwise stay Electron-free -- notably
 * `database/startup.ts`, which is unit-tested without mocking `electron` --
 * can receive a `DbKeyStore` from its caller instead of importing this
 * module directly.
 */
import { app, safeStorage } from 'electron'
import { join } from 'path'
import { DbKeyStore, DEFAULT_DB_KEY_REGISTRY_FILENAME } from './db-key-store'
import type { SafeStorageLike } from './db-key-store'

let instance: DbKeyStore | null = null

const electronSafeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  ...(process.platform === 'linux'
    ? { getSelectedStorageBackend: () => safeStorage.getSelectedStorageBackend() }
    : {}),
  encryptString: (plainText) => safeStorage.encryptString(plainText),
  decryptString: (encrypted) => safeStorage.decryptString(encrypted)
}

export function getDbKeyStore(): DbKeyStore {
  if (instance === null) {
    instance = new DbKeyStore({
      registryPath: join(app.getPath('userData'), DEFAULT_DB_KEY_REGISTRY_FILENAME),
      safeStorage: electronSafeStorage
    })
  }
  return instance
}
