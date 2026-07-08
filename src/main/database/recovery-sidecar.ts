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

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type { PassphraseWrap } from './db-key-store'

/** Sidecar filename suffix, appended directly to the database's absolute path. */
export const RECOVERY_SIDECAR_SUFFIX = '.varlens-recovery.json'

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

function isValidPassphraseWrapShape(value: unknown): value is PassphraseWrap {
  if (value === null || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.saltB64 === 'string' &&
    typeof v.ivB64 === 'string' &&
    typeof v.ctB64 === 'string' &&
    typeof v.tagB64 === 'string'
  )
}

/**
 * Atomic write (mkdir parent + write-to-tmp + rename), mirroring
 * `DbKeyStore`'s private `save()` method. Real fs errors (disk full,
 * permission denied, …) propagate -- the caller decides whether that's
 * fatal; this is always called as a best-effort step alongside a registry
 * write that has already succeeded.
 */
export function writeRecoverySidecar(dbPath: string, passWrap: PassphraseWrap): void {
  const sidecarPath = recoverySidecarPathFor(dbPath)
  mkdirSync(dirname(sidecarPath), { recursive: true })

  const sidecar: RecoverySidecar = { version: 1, passWrap }
  const json = JSON.stringify(sidecar, null, 2)
  const tmpPath = `${sidecarPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  writeFileSync(tmpPath, json, 'utf-8')
  renameSync(tmpPath, sidecarPath)
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
    const raw = readFileSync(sidecarPath, 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return null
    const v = parsed as { version?: unknown; passWrap?: unknown }
    if (typeof v.version !== 'number' || !isValidPassphraseWrapShape(v.passWrap)) {
      return null
    }
    return { version: v.version, passWrap: v.passWrap }
  } catch {
    return null
  }
}
