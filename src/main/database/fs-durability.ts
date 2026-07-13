/**
 * fs-durability.ts -- small fsync helpers for making an atomic
 * write-temp-then-rename durable across a crash/power-loss.
 *
 * Mirrors the pattern `plaintext-migration.ts` already uses for its step-6
 * atomic swap. Shared by `db-key-store.ts` (registry writes) and
 * `recovery-sidecar.ts` (sidecar writes) -- both persist the wrapped DEK an
 * encrypted database depends on, so a crash between "file exists" and "bytes
 * durable on disk" must not be able to leave a wrapped key unrecoverable.
 */

import { closeSync, fsyncSync, openSync } from 'fs'
import { dirname } from 'path'

/**
 * Fsync a regular file so its bytes are durably on disk before a caller's
 * atomic rename depends on them. Real failures propagate -- the caller
 * decides whether that's fatal to the write it's protecting.
 */
export function fsyncFile(filePath: string): void {
  const fd = openSync(filePath, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/**
 * Best-effort fsync of the directory containing `filePath`, so the
 * just-renamed directory entry is itself durable, not only the file's
 * contents. Some platforms/filesystems (notably Windows) cannot open/fsync a
 * directory handle at all -- that failure, and any other failure here, is
 * intentionally swallowed: the rename itself has already succeeded by the
 * time this runs, so failing the caller over this extra durability nicety
 * would be worse than the gap it narrows.
 */
export function fsyncContainingDirectory(filePath: string): void {
  try {
    const fd = openSync(dirname(filePath), 'r')
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  } catch {
    // Expected on platforms that don't support directory fsync.
  }
}
