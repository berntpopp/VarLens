/**
 * recovery-sidecar.ts -- portable escrow of a DB's passphrase wrap, living
 * next to the `.db` file itself.
 *
 * `DbKeyStore`'s registry (`userData/varlens-db-keys.json`) is keyed by
 * absolute path and lives OUTSIDE the database file. That makes a
 * passphrase-wrapped DEK non-portable in two ways this module fixes:
 *   - copying the `.db` file to another machine leaves the registry (and
 *     thus the passphrase wrap) behind -- the copy is unopenable even with
 *     the correct passphrase.
 *   - an OS reinstall or userData wipe destroys the registry -- same
 *     failure, even on the ORIGINAL machine.
 *
 * The fix: whenever a passphrase wrap is created or replaced, ALSO persist
 * that exact `PassphraseWrap` JSON to a sidecar file at
 * `<dbPath>.varlens-recovery.json`, using the same "sidecar next to the
 * database" convention `plaintext-migration.ts` already uses for
 * `<path>.plaintext-backup-<ts>` and `<path>.encrypting-<nonce>.tmp`.
 *
 * The sidecar is safe to leave next to an encrypted database: without the
 * passphrase it is scrypt+AES-256-GCM ciphertext and reveals nothing. It
 * NEVER contains the DEK, a safeStorage wrap, or the raw passphrase -- only
 * the `PassphraseWrap` fields plus a small version tag.
 */

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { dirname } from 'path'
import type { PassphraseWrap } from './db-key-passphrase'
import { fsyncContainingDirectory, fsyncFile } from './fs-durability'

/** Sidecar filename suffix, appended directly to the database's absolute path. */
export const RECOVERY_SIDECAR_SUFFIX = '.varlens-recovery.json'
export const MAX_RECOVERY_SIDECAR_BYTES = 64 * 1024

const PASSPHRASE_WRAP_FIELD_BYTES = {
  saltB64: 16,
  ivB64: 12,
  ctB64: 64,
  tagB64: 16
} as const

/** On-disk shape of a recovery sidecar. Never carries the DEK or a safeStorage wrap. */
export interface RecoverySidecar {
  version: number
  passWrap: PassphraseWrap
}

/** `<dbPath>.varlens-recovery.json` -- simple string concatenation, matching the repo convention. */
export function recoverySidecarPathFor(dbPath: string): string {
  return `${dbPath}${RECOVERY_SIDECAR_SUFFIX}`
}

export function recoverySidecarExists(dbPath: string): boolean {
  return existsSync(recoverySidecarPathFor(dbPath))
}

function isCanonicalBase64OfLength(value: unknown, expectedBytes: number): value is string {
  if (typeof value !== 'string') return false
  try {
    const decoded = Buffer.from(value, 'base64')
    return decoded.length === expectedBytes && decoded.toString('base64') === value
  } catch {
    return false
  }
}

function isValidPassphraseWrapShape(value: unknown): value is PassphraseWrap {
  if (value === null || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    isCanonicalBase64OfLength(v.saltB64, PASSPHRASE_WRAP_FIELD_BYTES.saltB64) &&
    isCanonicalBase64OfLength(v.ivB64, PASSPHRASE_WRAP_FIELD_BYTES.ivB64) &&
    isCanonicalBase64OfLength(v.ctB64, PASSPHRASE_WRAP_FIELD_BYTES.ctB64) &&
    isCanonicalBase64OfLength(v.tagB64, PASSPHRASE_WRAP_FIELD_BYTES.tagB64)
  )
}

function readBoundedSidecar(sidecarPath: string): string | null {
  const fd = openSync(sidecarPath, 'r')
  try {
    const buffer = Buffer.alloc(MAX_RECOVERY_SIDECAR_BYTES + 1)
    let bytesRead = 0
    while (bytesRead < buffer.length) {
      const count = readSync(fd, buffer, bytesRead, buffer.length - bytesRead, null)
      if (count === 0) break
      bytesRead += count
    }
    if (bytesRead > MAX_RECOVERY_SIDECAR_BYTES) return null
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

/**
 * Atomic write (mkdir parent + write-to-tmp + rename), mirroring
 * `DbKeyStore`'s private `save()` method. Real fs errors (disk full,
 * permission denied, …) propagate -- the caller decides whether that's
 * fatal; this is always called as a best-effort step alongside a registry
 * write that has already succeeded.
 *
 * Fsyncs the temp file's bytes to disk BEFORE the rename that makes them
 * live, then best-effort fsyncs the containing directory after the rename --
 * a crash between "file exists" and "bytes durable" must never be able to
 * leave the portable recovery wrap unrecoverable. See `fs-durability.ts`.
 */
export function writeRecoverySidecar(dbPath: string, passWrap: PassphraseWrap): void {
  const sidecarPath = recoverySidecarPathFor(dbPath)
  mkdirSync(dirname(sidecarPath), { recursive: true })

  const sidecar: RecoverySidecar = { version: 1, passWrap }
  const json = JSON.stringify(sidecar, null, 2)
  const tmpPath = `${sidecarPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  writeFileSync(tmpPath, json, 'utf-8')
  fsyncFile(tmpPath)
  renameSync(tmpPath, sidecarPath)
  fsyncContainingDirectory(sidecarPath)
}

/** Remove a recovery sidecar and durably publish the directory entry change. */
export function removeRecoverySidecar(dbPath: string): void {
  const sidecarPath = recoverySidecarPathFor(dbPath)
  if (!existsSync(sidecarPath)) return
  unlinkSync(sidecarPath)
  fsyncContainingDirectory(sidecarPath)
}

/**
 * Tolerant read: a missing file returns `null`; corrupt/malformed JSON or a
 * wrong shape also returns `null` -- this NEVER throws, since a sidecar is
 * always an optional recovery aid, never a hard dependency.
 */
export function readRecoverySidecar(dbPath: string): RecoverySidecar | null {
  const sidecarPath = recoverySidecarPathFor(dbPath)
  if (!existsSync(sidecarPath)) {
    return null
  }

  try {
    const raw = readBoundedSidecar(sidecarPath)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return null
    const v = parsed as { version?: unknown; passWrap?: unknown }
    if (v.version !== 1 || !isValidPassphraseWrapShape(v.passWrap)) {
      return null
    }
    return { version: v.version, passWrap: v.passWrap }
  } catch {
    return null
  }
}
