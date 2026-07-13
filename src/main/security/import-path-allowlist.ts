import { realpathSync } from 'fs'
import { app } from 'electron'
import { isAbsolute, relative, resolve, sep } from 'path'
import { homedir, tmpdir } from 'node:os'
import { PathAuthorityStore } from './path-authority-store'

/**
 * In-memory session allow-list of paths the user explicitly picked via an
 * Electron file dialog this session (or that were derived from one — files
 * discovered inside a dialog-picked folder, files extracted from a
 * dialog-picked ZIP). Cleared on app restart.
 *
 * This module exposes two predicates over that state:
 *
 *   - `isAllowedImportPath` — the enrolled set OR the three Electron-managed
 *     directory roots (home, userData, temp). Intentionally permissive;
 *     reserved for the original `import.ts` single/batch-file import flow.
 *   - `isStrictlyEnrolledPath` — the enrolled set ONLY, never the automatic
 *     roots. Use this for any other gate (DB open/create, BED import,
 *     batch-import paths, shell reveal) where "the user picked this exact
 *     path via a dialog this session" is the intended authority boundary.
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

/**
 * True only if `candidate` (after the same canonicalization used elsewhere
 * in this module) is in the explicitly dialog-enrolled set. Never consults
 * the automatic home/userData/temp roots below.
 */
function isDialogEnrolled(abs: string, realCandidate: string | null): boolean {
  void realCandidate
  return dialogAllowedPaths.isAuthorized(abs)
}

/**
 * Strict path-authority check: true only if `candidate` was explicitly
 * enrolled this session via `addAllowedImportPath` (picked through an
 * Electron file dialog, or derived from one — a file discovered inside a
 * dialog-picked folder, or a file extracted from a dialog-picked ZIP).
 *
 * Unlike `isAllowedImportPath`, this does NOT grant the automatic
 * home/userData/temp roots. Those roots are appropriate for the original
 * `import.ts` flow (see module docblock) but are far too broad for gates
 * where "the user picked this exact path via a dialog this session" is the
 * intended authority boundary — DB open/create, BED import, batch-import
 * paths, and shell "reveal in folder".
 */
export function isStrictlyEnrolledPath(candidate: string): boolean {
  if (!isAbsolute(candidate)) return false

  const abs = resolve(candidate)
  if (abs !== candidate) return false

  const realCandidate = tryRealpath(abs)

  return isDialogEnrolled(abs, realCandidate)
}

export function isAllowedImportPath(candidate: string): boolean {
  if (!isAbsolute(candidate)) return false

  const abs = resolve(candidate)
  if (abs !== candidate) return false

  const realCandidate = tryRealpath(abs)

  if (dialogAllowedPaths.hasEnrollment(abs)) {
    return isDialogEnrolled(abs, realCandidate)
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
