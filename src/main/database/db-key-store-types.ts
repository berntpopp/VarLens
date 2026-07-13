/** Injectable subset of Electron's safeStorage API. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  getSelectedStorageBackend?(): string
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

export type CreateManagedKeyResult =
  | { ok: true; keyId: string; dek: string }
  | { ok: false; reason: 'safe-storage-unavailable' | 'path-already-keyed' }

export type WrapNewDekWithPassphraseResult =
  | { ok: true; keyId: string; dek: string; sidecarWritten: boolean }
  | { ok: false; reason: 'path-already-keyed' }

export type ResolveKeyResult =
  { ok: true; dek: string } | { ok: false; reason: 'not-found' | 'needs-passphrase' }

export type ResolveKeyWithPassphraseResult =
  { ok: true; dek: string } | { ok: false; reason: 'not-found' | 'wrong-passphrase' }

export type ResolveKeyWithPassphraseFromSidecarResult =
  { ok: true; dek: string } | { ok: false; reason: 'wrong-passphrase' }

export type SetPassphraseResult =
  { ok: true; sidecarWritten: boolean } | { ok: false; reason: 'not-found' | 'cannot-resolve-dek' }

export type EnrollRecoveredKeyResult = { ok: true; keyId: string }
