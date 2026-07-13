import { isAbsolute, resolve } from 'node:path'
import { PathAuthorityStore } from './path-authority-store'

/** Export-only session capabilities used by `export:revealInFolder`. */
const exportRevealPaths = new PathAuthorityStore()

export function addAllowedExportRevealPath(filePath: string): void {
  if (!isAbsolute(filePath) || resolve(filePath) !== filePath) return
  exportRevealPaths.add(filePath)
}

export function isAllowedExportRevealPath(filePath: string): boolean {
  if (!isAbsolute(filePath) || resolve(filePath) !== filePath) return false
  return exportRevealPaths.isAuthorized(filePath)
}

/** Test-only reset helper. Do not call from production code. */
export function __resetExportPathAllowlistForTests(): void {
  exportRevealPaths.clear()
}
