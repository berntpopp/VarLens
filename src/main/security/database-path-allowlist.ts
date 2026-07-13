import { lstatSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import type { DatabaseManager } from '../services/DatabaseManager'
import { PathAuthorityStore } from './path-authority-store'

const dialogAllowedDatabasePaths = new PathAuthorityStore()

export function addAllowedDatabasePath(absolutePath: string): void {
  if (!isAbsolute(absolutePath) || resolve(absolutePath) !== absolutePath) return
  dialogAllowedDatabasePaths.add(absolutePath)
}

export function isStrictlyEnrolledDatabasePath(candidate: string): boolean {
  if (!isAbsolute(candidate)) return false

  const resolved = resolve(candidate)
  if (resolved !== candidate) return false

  return dialogAllowedDatabasePaths.isAuthorized(resolved)
}

export function isAllowedDatabasePath(
  candidate: string,
  getDbManager: () => DatabaseManager
): boolean {
  if (isStrictlyEnrolledDatabasePath(candidate)) return true
  if (!isAbsolute(candidate)) return false

  const canonical = resolve(candidate)
  if (canonical !== candidate) return false

  // A dialog enrollment is a pinned capability. If its target changed,
  // fail closed instead of resurrecting the stale path merely because the
  // same lexical string is still present in current/recent metadata.
  if (dialogAllowedDatabasePaths.hasEnrollment(canonical)) {
    return dialogAllowedDatabasePaths.isAuthorized(canonical)
  }

  // Persisted current/recent metadata records only a lexical path; it does
  // not retain the real target needed to pin a symlink. Require the user to
  // select such paths again so the session store can capture that target.
  if (resolvesThroughSymlink(canonical)) return false

  const manager = getDbManager()
  const currentPath = manager.getCurrentPath()
  if (currentPath !== null && isExactMetadataPath(currentPath, canonical)) return true
  return manager.getRecentDatabases().some((db) => isExactMetadataPath(db.path, canonical))
}

function isExactMetadataPath(storedPath: string, candidate: string): boolean {
  return isAbsolute(storedPath) && resolve(storedPath) === storedPath && storedPath === candidate
}

function resolvesThroughSymlink(filePath: string): boolean {
  let cursor = filePath
  while (true) {
    try {
      if (lstatSync(cursor).isSymbolicLink()) return true
    } catch {
      // Missing leaf paths may still have a symlinked existing ancestor.
    }
    const parent = dirname(cursor)
    if (parent === cursor) return false
    cursor = parent
  }
}

/** Test-only reset helper. Do not call from production code. */
export function __resetDatabasePathAllowlistForTests(): void {
  dialogAllowedDatabasePaths.clear()
}
