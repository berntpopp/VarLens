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
import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scryptSync } from 'crypto'
import { assertNotHexLiteralKey } from './sqlcipher-key-guard'
import { mainLogger } from '../services/MainLogger'

/** Default registry filename, intended to live under Electron's `userData` dir. */
export const DEFAULT_DB_KEY_REGISTRY_FILENAME = 'varlens-db-keys.json'

/**
 * The subset of Electron's `safeStorage` API this store depends on.
 * Injected so the store can be unit-tested without Electron.
 */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

/** AES-256-GCM passphrase wrap of a DEK. All fields are base64-encoded. */
interface PassphraseWrap {
  saltB64: string
  ivB64: string
  ctB64: string
  tagB64: string
}

/** One registry entry: where the DB lives and how its DEK is wrapped. */
interface KeyEntry {
  path: string
  /** base64 of `safeStorage.encryptString(dekHex)`. Present when a keyring wrap exists. */
  safeWrap?: string
  /** Present when a passphrase wrap exists. */
  passWrap?: PassphraseWrap
}

/**
 * On-disk registry shape. Values are typed as possibly-`undefined` because
 * plain `Record<K, V>` indexing does not reflect that a lookup by an
 * arbitrary key can miss — this project does not enable
 * `noUncheckedIndexedAccess`, so the optionality is spelled out explicitly.
 */
interface Registry {
  keys: Record<string, KeyEntry | undefined>
  pathIndex: Record<string, string | undefined>
}

export type CreateManagedKeyResult =
  | { ok: true; keyId: string; dek: string }
  | { ok: false; reason: 'safe-storage-unavailable' | 'path-already-keyed' }

export type WrapNewDekWithPassphraseResult =
  { ok: true; keyId: string; dek: string } | { ok: false; reason: 'path-already-keyed' }

export type ResolveKeyResult =
  { ok: true; dek: string } | { ok: false; reason: 'not-found' | 'needs-passphrase' }

export type ResolveKeyWithPassphraseResult =
  { ok: true; dek: string } | { ok: false; reason: 'not-found' | 'wrong-passphrase' }

export type SetPassphraseResult =
  { ok: true } | { ok: false; reason: 'not-found' | 'cannot-resolve-dek' }

/** scrypt cost parameters. N=16384, r=8, p=1 derives ~16 MiB, under Node's default 32 MiB maxmem. */
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const
const SCRYPT_KEY_LENGTH = 32
const GCM_IV_LENGTH = 12
const PASSPHRASE_SALT_LENGTH = 16
const DEK_BYTE_LENGTH = 32

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function emptyRegistry(): Registry {
  return { keys: {}, pathIndex: {} }
}

function isValidRegistryShape(value: unknown): value is Registry {
  if (value === null || typeof value !== 'object') return false
  const v = value as { keys?: unknown; pathIndex?: unknown }
  return (
    typeof v.keys === 'object' &&
    v.keys !== null &&
    !Array.isArray(v.keys) &&
    typeof v.pathIndex === 'object' &&
    v.pathIndex !== null &&
    !Array.isArray(v.pathIndex)
  )
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

function wrapPassphrase(dek: string, passphrase: string): PassphraseWrap {
  const salt = randomBytes(PASSPHRASE_SALT_LENGTH)
  const iv = randomBytes(GCM_IV_LENGTH)
  const derivedKey = scryptSync(passphrase, salt, SCRYPT_KEY_LENGTH, SCRYPT_PARAMS)
  const cipher = createCipheriv('aes-256-gcm', derivedKey, iv)
  const ct = Buffer.concat([cipher.update(dek, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    saltB64: salt.toString('base64'),
    ivB64: iv.toString('base64'),
    ctB64: ct.toString('base64'),
    tagB64: tag.toString('base64')
  }
}

/** Returns the unwrapped DEK, or null on a wrong passphrase (GCM auth failure) or malformed wrap. */
function unwrapPassphrase(wrap: PassphraseWrap, passphrase: string): string | null {
  try {
    const salt = Buffer.from(wrap.saltB64, 'base64')
    const iv = Buffer.from(wrap.ivB64, 'base64')
    const ct = Buffer.from(wrap.ctB64, 'base64')
    const tag = Buffer.from(wrap.tagB64, 'base64')
    const derivedKey = scryptSync(passphrase, salt, SCRYPT_KEY_LENGTH, SCRYPT_PARAMS)
    const decipher = createDecipheriv('aes-256-gcm', derivedKey, iv)
    decipher.setAuthTag(tag)
    const pt = Buffer.concat([decipher.update(ct), decipher.final()])
    return pt.toString('utf8')
  } catch {
    // GCM auth failure (wrong passphrase) or malformed wrap material.
    // Never surface crypto internals — the caller only needs "it failed".
    return null
  }
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
    const registry = this.load()
    if (registry.pathIndex[dbPath] !== undefined) {
      return { ok: false, reason: 'path-already-keyed' }
    }

    if (!this.safeStorage.isEncryptionAvailable()) {
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
    registry.keys[keyId] = { path: dbPath, safeWrap }
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
    const registry = this.load()
    if (registry.pathIndex[dbPath] !== undefined) {
      return { ok: false, reason: 'path-already-keyed' }
    }

    const dek = generateDek()
    const keyId = randomUUID()
    const passWrap = wrapPassphrase(dek, passphrase)

    registry.keys[keyId] = { path: dbPath, passWrap }
    registry.pathIndex[dbPath] = keyId
    this.save(registry)

    return { ok: true, keyId, dek }
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
    return { ok: true }
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

  /** Attempt to unwrap `entry.safeWrap` via the injected safeStorage; null on any failure. */
  private tryUnwrapWithSafeStorage(entry: KeyEntry): string | null {
    if (entry.safeWrap === undefined || !this.safeStorage.isEncryptionAvailable()) {
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

  /**
   * Read the registry from disk. Tolerates a missing file (fresh install —
   * treated as empty, no logging). Never throws on a corrupt file: it is
   * preserved as `<registryPath>.bak` and a warning is logged, so keys are
   * not silently lost even though this read returns an empty registry.
   */
  private load(): Registry {
    if (!existsSync(this.registryPath)) {
      return emptyRegistry()
    }

    let raw: string
    try {
      raw = readFileSync(this.registryPath, 'utf-8')
    } catch (e) {
      mainLogger.warn(`Failed to read key registry file: ${errorMessage(e)}`, 'DbKeyStore')
      return emptyRegistry()
    }

    try {
      const parsed: unknown = JSON.parse(raw)
      if (!isValidRegistryShape(parsed)) {
        throw new Error('unexpected key registry shape')
      }
      return parsed
    } catch (e) {
      this.preserveCorruptBackup(raw)
      mainLogger.warn(
        `Key registry file was corrupt or invalid; treating as empty and preserving a backup at ${this.registryPath}.bak: ${errorMessage(e)}`,
        'DbKeyStore'
      )
      return emptyRegistry()
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

  /** Write the registry to disk (mkdir -p + write-then-rename for atomicity). */
  private save(registry: Registry): void {
    const dir = dirname(this.registryPath)
    mkdirSync(dir, { recursive: true })
    const json = JSON.stringify(registry, null, 2)
    const tmpPath = `${this.registryPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    writeFileSync(tmpPath, json, 'utf-8')
    renameSync(tmpPath, this.registryPath)
  }
}

/**
 * The subset of `DbKeyStore` consumed by the DB create/open flow
 * (`database-logic.ts`, `database/startup.ts`). Narrowed so those modules
 * can accept an injected fake in tests without depending on the full class.
 */
export type DbKeyStoreLike = Pick<
  DbKeyStore,
  'createManagedKey' | 'wrapNewDekWithPassphrase' | 'resolveKeyForPath' | 'resolveKeyWithPassphrase'
>
