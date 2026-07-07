import { realpathSync } from 'fs'
import { isAbsolute, resolve } from 'path'

const dialogAllowedDatabasePaths = new Set<string>()

export function addAllowedDatabasePath(absolutePath: string): void {
  const resolved = resolve(absolutePath)
  dialogAllowedDatabasePaths.add(resolved)

  const realPath = tryRealpath(resolved)
  if (realPath !== null) {
    dialogAllowedDatabasePaths.add(realPath)
  }
}

export function isStrictlyEnrolledDatabasePath(candidate: string): boolean {
  if (!isAbsolute(candidate)) return false

  const resolved = resolve(candidate)
  if (resolved !== candidate) return false

  const realCandidate = tryRealpath(resolved)
  return (
    dialogAllowedDatabasePaths.has(resolved) ||
    (realCandidate !== null && dialogAllowedDatabasePaths.has(realCandidate))
  )
}

/** Test-only reset helper. Do not call from production code. */
export function __resetDatabasePathAllowlistForTests(): void {
  dialogAllowedDatabasePaths.clear()
}

function tryRealpath(filePath: string): string | null {
  try {
    return realpathSync.native(filePath)
  } catch {
    return null
  }
}
