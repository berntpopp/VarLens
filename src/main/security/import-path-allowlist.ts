import { isAbsolute, resolve } from 'path'
import { PathAuthorityStore } from './path-authority-store'

/**
 * In-memory session allow-list of paths the user explicitly picked via an
 * Electron file dialog this session (or that were derived from one — files
 * discovered inside a dialog-picked folder, files extracted from a
 * dialog-picked ZIP). Cleared on app restart.
 *
 * Main-process only. Workers cannot import 'electron' and therefore cannot
 * consult this allow-list; they receive paths that main has already
 * validated. BedFilter.fromFile keeps a worker-safe defensive check as
 * defence-in-depth.
 */
const dialogAllowedPaths = new PathAuthorityStore()

export function addAllowedImportPath(absolutePath: string): void {
  if (!isAbsolute(absolutePath) || resolve(absolutePath) !== absolutePath) return
  dialogAllowedPaths.add(absolutePath)
}

export function removeAllowedImportPath(absolutePath: string): void {
  dialogAllowedPaths.remove(absolutePath)
}

/**
 * Strict path-authority check: true only if `candidate` was explicitly
 * enrolled this session via `addAllowedImportPath` (picked through an
 * Electron file dialog, or derived from one — a file discovered inside a
 * dialog-picked folder, or a file extracted from a dialog-picked ZIP).
 */
export function isStrictlyEnrolledPath(candidate: string): boolean {
  if (!isAbsolute(candidate)) return false

  const abs = resolve(candidate)
  if (abs !== candidate) return false

  return dialogAllowedPaths.isAuthorized(abs)
}

/** Test-only reset helper. Do not call from production code. */
export function __resetAllowlistForTests(): void {
  dialogAllowedPaths.clear()
}
