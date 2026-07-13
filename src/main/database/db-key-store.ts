/**
 * DbKeyStore — envelope-encryption key-lifecycle store for the SQLCipher DEK.
 *
 * Design (see .superpowers/sdd/task-I1-brief.md for the full rationale):
 * - The DEK (data-encryption key) is a random 32-byte value, hex-encoded
 *   (64 lowercase hex chars). It IS the SQLCipher `PRAGMA key` value. A
 *   database is always encrypted with a stable random DEK — the DEK itself
 *   never changes; only how it is *wrapped* changes.
 * - The DEK is wrapped (either or both):
 *     - safeStorage wrap (transparent): `safeStorage.encryptString(dekHex)`,
 *       stored base64-encoded. OS-keyring-protected; only usable on the
 *       machine/profile that created it.
 *     - passphrase wrap (portable): AES-256-GCM encryption of the dekHex
 *       using a key derived from the passphrase via scrypt. Portable across
 *       machines because it only depends on the user knowing the passphrase.
 * - A registry JSON file maps `keyId -> { path, safeWrap?, passWrap? }` plus
 *   a reverse `path -> keyId` index. Switching keyring<->passphrase is just
 *   re-wrapping the SAME DEK — never a DB rekey.
 * - This module does NOT touch any DB open/create flow. It is a pure,
 *   injectable key-lifecycle store consumed by later tasks.
 *
 * Security notes:
 * - `safeStorage` is injected (constructor param), never imported from
 *   `electron` in this file, so the crypto logic is unit-testable with a
 *   fake and has no Electron runtime dependency.
 * - Only Node's built-in `crypto` is used (no new dependencies).
 * - The DEK, a passphrase, and any wrap material are NEVER logged or placed
 *   in a thrown error message. Recoverable failure modes are returned as
 *   typed result objects instead of throwing.
 * - A hex-encoded DEK (charset `0-9a-f`) can never start with `x` or `X`,
 *   so it can never collide with SQLCipher's `x'<hex>'` hex-literal PRAGMA
 *   syntax. `assertNotHexLiteralKey` is still called defensively on every
 *   newly generated DEK — see `sqlcipher-key-guard.ts`.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { randomBytes, randomUUID } from 'crypto'
import { assertNotHexLiteralKey } from './sqlcipher-key-guard'
import { mainLogger } from '../services/MainLogger'
import { writeRecoverySidecar } from './recovery-sidecar'
import { fsyncContainingDirectory, fsyncFile } from './fs-durability'
import { unwrapPassphrase, wrapPassphrase, type PassphraseWrap } from './db-key-passphrase'
import type {
  CreateManagedKeyResult,
  EnrollRecoveredKeyResult,
  ResolveKeyResult,
  ResolveKeyWithPassphraseFromSidecarResult,
  ResolveKeyWithPassphraseResult,
  SafeStorageLike,
  SetPassphraseResult,
  WrapNewDekWithPassphraseResult
} from './db-key-store-types'
import {
  emptyKeyRegistry,
  isValidKeyRegistryShape,
  type KeyEntry,
  type KeyRegistry
} from './db-key-registry'

export type { PassphraseWrap } from './db-key-passphrase'
export type * from './db-key-store-types'

/** Default registry filename, intended to live under Electron's `userData` dir. */
export const DEFAULT_DB_KEY_REGISTRY_FILENAME = 'varlens-db-keys.json'

const DEK_BYTE_LENGTH = 32

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Generate a fresh 64-hex-char DEK. Hex chars are `0-9a-f`, so the result
 * can never start with `x`/`X` and can never be mistaken for SQLCipher's
 * `x'<hex>'` hex-literal PRAGMA syntax — asserted defensively regardless.
 */
function generateDek(): string {
  const dek = randomBytes(DEK_BYTE_LENGTH).toString('hex')
  assertNotHexLiteralKey(dek)
  return dek
}

/**
 * Envelope-encryption key-lifecycle store for SQLCipher DEKs.
 *
 * Every method reads the registry fresh from disk and writes it back after
 * mutating, so multiple `DbKeyStore` instances over the same `registryPath`
 * stay consistent (see the "Registry persistence" test case).
 */
export class DbKeyStore {
  private readonly registryPath: string
  private readonly safeStorage: SafeStorageLike

  constructor(options: { registryPath: string; safeStorage: SafeStorageLike }) {
    this.registryPath = options.registryPath
    this.safeStorage = options.safeStorage
  }

  /**
   * Create a new managed (keyring-wrapped) DEK for `dbPath`.
   * Fails with a typed result (never throws) when safeStorage is unavailable,
   * so the caller can fall back to `wrapNewDekWithPassphrase`. Also fails
   * with `path-already-keyed` when `dbPath` is already mapped to a key —
   * minting a second DEK for an already-keyed path would repoint
   * `pathIndex[dbPath]` at the new key and orphan the DEK the database was
   * actually encrypted with, making the database unopenable.
   */
  createManagedKey(dbPath: string): CreateManagedKeyResult {
    return this.createManagedKeyWithState(dbPath, 'active')
  }

  /** Mint a managed key that is not authoritative until a verified encrypted open activates it. */
  createPendingManagedKey(dbPath: string): CreateManagedKeyResult {
    return this.createManagedKeyWithState(dbPath, 'pending')
  }

  private createManagedKeyWithState(
    dbPath: string,
    state: 'pending' | 'active'
  ): CreateManagedKeyResult {
    const registry = this.load()
    if (registry.pathIndex[dbPath] !== undefined) {
      return { ok: false, reason: 'path-already-keyed' }
    }

    if (!this.isSecureStorageAvailable()) {
      return { ok: false, reason: 'safe-storage-unavailable' }
    }

    const dek = generateDek()
    let safeWrap: string
    try {
      safeWrap = this.safeStorage.encryptString(dek).toString('base64')
    } catch (e) {
      mainLogger.warn(
        `safeStorage.encryptString failed while creating a managed key: ${errorMessage(e)}`,
        'DbKeyStore'
      )
      return { ok: false, reason: 'safe-storage-unavailable' }
    }

    const keyId = randomUUID()
    registry.keys[keyId] = { path: dbPath, safeWrap, state }
    registry.pathIndex[dbPath] = keyId
    this.save(registry)

    return { ok: true, keyId, dek }
  }

  /**
   * The no-keyring create path: generate a DEK, wrap it with ONLY a
   * passphrase (no safeWrap), and map `dbPath` to it. Fails with a typed
   * result (never throws) when `dbPath` is already mapped to a key —
   * minting a second DEK for an already-keyed path would repoint
   * `pathIndex[dbPath]` at the new key and orphan the DEK the database was
   * actually encrypted with, making the database unopenable.
   */
  wrapNewDekWithPassphrase(dbPath: string, passphrase: string): WrapNewDekWithPassphraseResult {
    return this.wrapNewDekWithPassphraseAndState(dbPath, passphrase, 'active')
  }

  /** Passphrase-only counterpart to `createPendingManagedKey`. */
  wrapNewPendingDekWithPassphrase(
    dbPath: string,
    passphrase: string
  ): WrapNewDekWithPassphraseResult {
    return this.wrapNewDekWithPassphraseAndState(dbPath, passphrase, 'pending')
  }

  private wrapNewDekWithPassphraseAndState(
    dbPath: string,
    passphrase: string,
    state: 'pending' | 'active'
  ): WrapNewDekWithPassphraseResult {
    const registry = this.load()
    if (registry.pathIndex[dbPath] !== undefined) {
      return { ok: false, reason: 'path-already-keyed' }
    }

    const dek = generateDek()
    const keyId = randomUUID()
    const passWrap = wrapPassphrase(dek, passphrase)

    registry.keys[keyId] = { path: dbPath, passWrap, state }
    registry.pathIndex[dbPath] = keyId
    this.save(registry)

    const sidecarWritten = this.tryWriteRecoverySidecar(dbPath, passWrap)

    return { ok: true, keyId, dek, sidecarWritten }
  }

  /**
   * Resolve the DEK for `dbPath` transparently (via an existing safeStorage
   * wrap). Returns `needs-passphrase` — never a wrong key — when the entry
   * only has a passphrase wrap, or when safeStorage cannot unwrap it right
   * now (e.g. moved to a machine without the original OS keyring).
   */
  resolveKeyForPath(dbPath: string): ResolveKeyResult {
    const registry = this.load()
    const keyId = registry.pathIndex[dbPath]
    const entry = keyId === undefined ? undefined : registry.keys[keyId]
    if (!entry) {
      return { ok: false, reason: 'not-found' }
    }

    const dek = this.tryUnwrapWithSafeStorage(entry)
    if (dek !== null) {
      return { ok: true, dek }
    }
    return { ok: false, reason: 'needs-passphrase' }
  }

  /**
   * Resolve the DEK for `dbPath` using a passphrase wrap. Distinguishes "no
   * such path/entry" from "wrong passphrase" (GCM auth failure) — a wrong
   * passphrase never returns a different, wrong key.
   */
  resolveKeyWithPassphrase(dbPath: string, passphrase: string): ResolveKeyWithPassphraseResult {
    const registry = this.load()
    const keyId = registry.pathIndex[dbPath]
    const entry = keyId === undefined ? undefined : registry.keys[keyId]
    if (!entry || entry.passWrap === undefined) {
      return { ok: false, reason: 'not-found' }
    }

    const dek = unwrapPassphrase(entry.passWrap, passphrase)
    if (dek === null) {
      return { ok: false, reason: 'wrong-passphrase' }
    }
    return { ok: true, dek }
  }

  /**
   * Resolve a DEK from a `PassphraseWrap` read directly from a recovery
   * sidecar -- no registry or filesystem access here, purely a wrapper
   * around `unwrapPassphrase`. AES-GCM's auth tag means a wrong passphrase
   * can only ever produce `null` (never a different, plausible-looking
   * wrong key), so this can only fail as `wrong-passphrase`.
   */
  resolveKeyWithPassphraseFromSidecar(
    passWrap: PassphraseWrap,
    passphrase: string
  ): ResolveKeyWithPassphraseFromSidecarResult {
    const dek = unwrapPassphrase(passWrap, passphrase)
    if (dek === null) {
      return { ok: false, reason: 'wrong-passphrase' }
    }
    return { ok: true, dek }
  }

  /**
   * Add or replace the passphrase wrap for an existing DEK identified by
   * `keyId`. The DEK is resolved internally via the entry's existing
   * safeStorage wrap — this store never wraps a DEK it cannot itself
   * resolve, so an unknown/unresolvable key never gets a passphrase wrap.
   */
  setPassphrase(keyId: string, passphrase: string): SetPassphraseResult {
    const registry = this.load()
    const entry = registry.keys[keyId]
    if (!entry) {
      return { ok: false, reason: 'not-found' }
    }

    const dek = this.tryUnwrapWithSafeStorage(entry)
    if (dek === null) {
      return { ok: false, reason: 'cannot-resolve-dek' }
    }

    entry.passWrap = wrapPassphrase(dek, passphrase)
    this.save(registry)
    const sidecarWritten = this.tryWriteRecoverySidecar(entry.path, entry.passWrap)
    return { ok: true, sidecarWritten }
  }

  /** Replace a passphrase wrap using the caller's already-verified session DEK. */
  setPassphraseForVerifiedDek(
    keyId: string,
    verifiedDek: string,
    passphrase: string
  ): SetPassphraseResult {
    const registry = this.load()
    const entry = registry.keys[keyId]
    if (!entry) {
      return { ok: false, reason: 'not-found' }
    }
    if (!/^[0-9a-f]{64}$/.test(verifiedDek)) {
      return { ok: false, reason: 'cannot-resolve-dek' }
    }

    entry.passWrap = wrapPassphrase(verifiedDek, passphrase)
    this.save(registry)
    const sidecarWritten = this.tryWriteRecoverySidecar(entry.path, entry.passWrap)
    return { ok: true, sidecarWritten }
  }

  /**
   * Direct `pathIndex` lookup, with no attempt to resolve/unwrap the DEK.
   * Consumed by the (separately implemented) `setRecoveryPassphrase` IPC
   * action, which needs the `keyId` for an already-open database's path
   * before it can call `setPassphrase`.
   */
  getKeyIdForPath(dbPath: string): string | null {
    const registry = this.load()
    return registry.pathIndex[dbPath] ?? null
  }

  /** Pending is explicit; legacy entries without a state are active. */
  getKeyStateForPath(dbPath: string): 'pending' | 'active' | null {
    const registry = this.load()
    const keyId = registry.pathIndex[dbPath]
    const entry = keyId === undefined ? undefined : registry.keys[keyId]
    if (entry === undefined) return null
    return entry.state ?? 'active'
  }

  /** Mark a pending key authoritative after SQLite has accepted its DEK. */
  activateKey(keyId: string): void {
    const registry = this.load()
    const entry = registry.keys[keyId]
    if (entry === undefined || entry.state !== 'pending') return
    entry.state = 'active'
    this.save(registry)
  }

  /**
   * Find a LOCAL registry entry whose safeStorage-wrapped DEK equals `dek`,
   * regardless of which path it's currently mapped to. Powers the
   * "same-machine move" self-heal: if a `.db` file (plus its recovery
   * sidecar) was moved to a new path on a machine that ALREADY has a
   * keyring entry for that exact DEK under the old path, this lets the
   * caller repoint that existing entry via `updatePath` instead of minting
   * a redundant, orphaned key. Returns `null` when nothing matches or
   * safeStorage is unavailable.
   */
  findManagedKeyIdForDek(dek: string): string | null {
    const registry = this.load()
    for (const [keyId, entry] of Object.entries(registry.keys)) {
      if (entry === undefined || entry.safeWrap === undefined) continue
      if (this.tryUnwrapWithSafeStorage(entry) === dek) {
        return keyId
      }
    }
    return null
  }

  /**
   * Enroll a DEK recovered from a portable sidecar as a brand-new registry
   * entry for `dbPath`, so future opens on THIS machine are transparent.
   * The caller must first prove SQLite accepts `dek`. That verification makes
   * a pre-existing mapping at this path stale: the new entry replaces only
   * `pathIndex[dbPath]`, while the displaced wrapped key remains in `keys` so
   * a moved copy of the old database is still recoverable by DEK lookup.
   * Best-effort ALSO adds a safeStorage wrap when available (non-fatal on
   * failure — the passphrase wrap being enrolled is enough on its own).
   * Does NOT re-write the sidecar: `passWrap` came FROM the sidecar, so it
   * is already on disk, correct, and current.
   */
  enrollRecoveredKey(
    dbPath: string,
    dek: string,
    passWrap: PassphraseWrap
  ): EnrollRecoveredKeyResult {
    const registry = this.load()

    const keyId = randomUUID()
    const entry: KeyEntry = { path: dbPath, passWrap }

    if (this.isSecureStorageAvailable()) {
      try {
        entry.safeWrap = this.safeStorage.encryptString(dek).toString('base64')
      } catch (e) {
        mainLogger.warn(
          `safeStorage.encryptString failed while enrolling a recovered key (continuing with ` +
            `the passphrase wrap alone): ${errorMessage(e)}`,
          'DbKeyStore'
        )
      }
    }

    registry.keys[keyId] = entry
    registry.pathIndex[dbPath] = keyId
    this.save(registry)

    return { ok: true, keyId }
  }

  /**
   * Move/rename: repoint `keyId` at `newPath`. Any previous path mapping(s)
   * for this key are removed so a stale path never resolves to the wrong
   * key — the caller sees a typed miss instead.
   */
  updatePath(keyId: string, newPath: string): void {
    const registry = this.load()
    const entry = registry.keys[keyId]
    if (!entry) {
      mainLogger.warn(`updatePath called for unknown keyId`, 'DbKeyStore')
      return
    }

    for (const [path, id] of Object.entries(registry.pathIndex)) {
      if (id === keyId) delete registry.pathIndex[path]
    }
    entry.path = newPath
    registry.pathIndex[newPath] = keyId
    this.save(registry)
  }

  /** Delete a key's registry entry and its path mapping(s). */
  removeKey(keyId: string): void {
    const registry = this.load()
    if (!registry.keys[keyId]) {
      return
    }
    delete registry.keys[keyId]
    for (const [path, id] of Object.entries(registry.pathIndex)) {
      if (id === keyId) delete registry.pathIndex[path]
    }
    this.save(registry)
  }

  /**
   * Best-effort write of a recovery sidecar alongside `dbPath`. Never
   * throws: a failure here (disk full, read-only filesystem, …) must not
   * fail the registry write it accompanies, so it is logged and reported
   * back to the caller as `sidecarWritten: false` instead.
   */
  private tryWriteRecoverySidecar(dbPath: string, passWrap: PassphraseWrap): boolean {
    try {
      writeRecoverySidecar(dbPath, passWrap)
      return true
    } catch (e) {
      mainLogger.warn(
        `Failed to write recovery sidecar for the database at this path (portability recovery ` +
          `will be unavailable if the registry is later lost): ${errorMessage(e)}`,
        'DbKeyStore'
      )
      return false
    }
  }

  /** Attempt to unwrap `entry.safeWrap` via the injected safeStorage; null on any failure. */
  private tryUnwrapWithSafeStorage(entry: KeyEntry): string | null {
    if (entry.safeWrap === undefined || !this.isSecureStorageAvailable()) {
      return null
    }
    try {
      const buf = Buffer.from(entry.safeWrap, 'base64')
      return this.safeStorage.decryptString(buf)
    } catch (e) {
      mainLogger.warn(`safeStorage.decryptString failed: ${errorMessage(e)}`, 'DbKeyStore')
      return null
    }
  }

  /** Electron's Linux `basic_text` backend is obfuscation, not secure storage. */
  private isSecureStorageAvailable(): boolean {
    try {
      return (
        this.safeStorage.isEncryptionAvailable() &&
        this.safeStorage.getSelectedStorageBackend?.() !== 'basic_text'
      )
    } catch (e) {
      mainLogger.warn(
        `Failed to determine secure storage availability: ${errorMessage(e)}`,
        'DbKeyStore'
      )
      return false
    }
  }

  /**
   * Read the registry from disk. A missing file is a fresh install and is
   * treated as empty. An existing unreadable or invalid registry fails
   * closed: returning an empty registry would let the next mutation replace
   * the only copy of every wrapped database key.
   */
  private load(): KeyRegistry {
    if (!existsSync(this.registryPath)) {
      return emptyKeyRegistry()
    }

    let raw: string
    try {
      raw = readFileSync(this.registryPath, 'utf-8')
    } catch (e) {
      mainLogger.warn(`Failed to read key registry file: ${errorMessage(e)}`, 'DbKeyStore')
      const error = new Error(
        'The database key registry could not be read; no key changes were made'
      )
      ;(error as Error & { cause?: unknown }).cause = e
      throw error
    }

    try {
      const parsed: unknown = JSON.parse(raw)
      if (!isValidKeyRegistryShape(parsed)) {
        throw new Error('unexpected key registry shape')
      }
      return parsed
    } catch (e) {
      this.preserveCorruptBackup(raw)
      mainLogger.warn(
        `Key registry file was corrupt or invalid; refusing to replace it and preserving a backup at ${this.registryPath}.bak: ${errorMessage(e)}`,
        'DbKeyStore'
      )
      const error = new Error(
        'The database key registry is corrupt or invalid; no key changes were made'
      )
      ;(error as Error & { cause?: unknown }).cause = e
      throw error
    }
  }

  private preserveCorruptBackup(raw: string): void {
    try {
      writeFileSync(`${this.registryPath}.bak`, raw, 'utf-8')
    } catch (e) {
      mainLogger.warn(
        `Failed to preserve corrupt key registry backup: ${errorMessage(e)}`,
        'DbKeyStore'
      )
    }
  }

  /** Write registry to disk (mkdir -p + write-temp + fsync + rename + best-effort dir fsync). */
  private save(registry: KeyRegistry): void {
    const dir = dirname(this.registryPath)
    mkdirSync(dir, { recursive: true })
    const json = JSON.stringify(registry, null, 2)
    const tmpPath = `${this.registryPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    writeFileSync(tmpPath, json, 'utf-8')
    fsyncFile(tmpPath)
    renameSync(tmpPath, this.registryPath)
    fsyncContainingDirectory(this.registryPath)
  }
}

/**
 * The subset of `DbKeyStore` consumed by the DB create/open flow
 * (`database-logic.ts`, `database/startup.ts`). Narrowed so those modules
 * can accept an injected fake in tests without depending on the full class.
 */
export type DbKeyStoreLike = Pick<
  DbKeyStore,
  | 'createManagedKey'
  | 'wrapNewDekWithPassphrase'
  | 'resolveKeyForPath'
  | 'resolveKeyWithPassphrase'
  | 'removeKey'
>

/**
 * Adds `setPassphrase` and `getKeyIdForPath` on top of `DbKeyStoreLike`.
 * `setPassphrase` alone is consumed by the plaintext-to-encrypted migration
 * orchestration (task I2b), which offers a recovery passphrase on a
 * freshly-minted managed key so keyring loss can't make the migrated data
 * unrecoverable. Both together are consumed by the `setRecoveryPassphrase`
 * IPC action (`database-lifecycle-logic.ts`), which resolves an already-open
 * database's `keyId` from its path before calling `setPassphrase` on it.
 * Kept separate from `DbKeyStoreLike` so existing consumers of that narrower
 * type (e.g. `database/startup.ts`'s hand-rolled "unavailable" fake) don't
 * need to implement methods they never call.
 */
export type DbKeyStoreWithPassphraseLike = DbKeyStoreLike &
  Pick<
    DbKeyStore,
    | 'setPassphrase'
    | 'setPassphraseForVerifiedDek'
    | 'getKeyIdForPath'
    | 'getKeyStateForPath'
    | 'activateKey'
    | 'createPendingManagedKey'
    | 'wrapNewPendingDekWithPassphrase'
  >

/**
 * Consumed by `openDatabase`'s recovery-sidecar flow: transparent resolve,
 * registry-based and sidecar-based passphrase resolution, the same-machine
 * move self-heal (`findManagedKeyIdForDek` + `updatePath`), and enrolling a
 * brand-new local entry when a sidecar recovers a DEK this machine has never
 * seen before (`enrollRecoveredKey`). Kept separate from `DbKeyStoreLike` so
 * existing narrower consumers (e.g. `createDatabase`, `database/startup.ts`)
 * don't need to implement methods they never call.
 */
export type DbKeyStoreWithRecoveryLike = Pick<
  DbKeyStore,
  | 'resolveKeyForPath'
  | 'resolveKeyWithPassphrase'
  | 'resolveKeyWithPassphraseFromSidecar'
  | 'findManagedKeyIdForDek'
  | 'enrollRecoveredKey'
  | 'updatePath'
  | 'removeKey'
  | 'getKeyIdForPath'
  | 'getKeyStateForPath'
  | 'activateKey'
>
