import { realpathSync } from 'fs'
import { app } from 'electron'
import { isAbsolute, relative, resolve, sep } from 'path'
import { homedir, tmpdir } from 'node:os'
import { PathAuthorityStore } from './path-authority-store'

/**
 * In-memory session allow-list of paths the user explicitly picked via an
 * Electron file dialog this session, plus the three Electron-managed
 * directory roots (home, userData, temp). Cleared on app restart.
 *
 * Main-process only. Workers cannot import 'electron' and therefore cannot
 * consult this allow-list; they receive paths that main has already
 * validated. BedFilter.fromFile keeps a worker-safe defensive check as
 * defence-in-depth.
 */
const dialogAllowedPaths = new PathAuthorityStore()

export function addAllowedImportPath(absolutePath: string): void {
  dialogAllowedPaths.add(absolutePath)
}

export function removeAllowedImportPath(absolutePath: string): void {
  dialogAllowedPaths.remove(absolutePath)
}

/** Require explicit session enrollment; automatic trusted roots do not count. */
export function isStrictlyEnrolledPath(candidate: string): boolean {
  if (!isAbsolute(candidate)) return false
  const abs = resolve(candidate)
  if (abs !== candidate) return false
  return dialogAllowedPaths.isAuthorized(abs)
}

export function isAllowedImportPath(candidate: string): boolean {
  if (!isAbsolute(candidate)) return false

  const abs = resolve(candidate)
  if (abs !== candidate) return false

  const realCandidate = tryRealpath(abs)

  if (dialogAllowedPaths.hasEnrollment(abs)) {
    return dialogAllowedPaths.isAuthorized(abs)
  }

  const roots: string[] = []
  try {
    roots.push(app.getPath('home'), app.getPath('userData'), app.getPath('temp'))
  } catch {
    if (process.env.TMPDIR !== undefined && process.env.TMPDIR !== '') {
      roots.push(process.env.TMPDIR)
    }
    if (process.env.HOME !== undefined && process.env.HOME !== '') {
      roots.push(process.env.HOME)
    }
    roots.push(homedir(), tmpdir())
  }

  return roots.some((root) => isUnderAutomaticRoot(abs, realCandidate, root))
}

/** Test-only reset helper. Do not call from production code. */
export function __resetAllowlistForTests(): void {
  dialogAllowedPaths.clear()
}

function tryRealpath(filePath: string): string | null {
  try {
    return realpathSync.native(filePath)
  } catch {
    return null
  }
}

function isUnderAutomaticRoot(abs: string, realCandidate: string | null, root: string): boolean {
  const resolvedRoot = resolve(root)
  const realRoot = tryRealpath(resolvedRoot)

  if (realCandidate !== null && realRoot !== null) {
    return containsPath(realRoot, realCandidate)
  }

  if (realCandidate !== null) {
    return false
  }

  return containsPath(resolvedRoot, abs)
}

function containsPath(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate)
  return (
    fromRoot === '' ||
    (fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot))
  )
}
