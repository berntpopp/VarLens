import { isAbsolute, resolve } from 'path'
import type { DatabaseManager } from '../services/DatabaseManager'
import { PathAuthorityStore } from './path-authority-store'

const dialogAllowedDatabasePaths = new PathAuthorityStore()

export function addAllowedDatabasePath(absolutePath: string): void {
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

  const manager = getDbManager()
  const currentPath = manager.getCurrentPath()
  if (currentPath !== null && resolve(currentPath) === canonical) return true
  return manager.getRecentDatabases().some((db) => resolve(db.path) === canonical)
}

/** Test-only reset helper. Do not call from production code. */
export function __resetDatabasePathAllowlistForTests(): void {
  dialogAllowedDatabasePaths.clear()
}
