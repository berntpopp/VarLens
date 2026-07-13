import { lstatSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'

interface PathEnrollment {
  realPath: string | null
  realParent: string | null
}

/**
 * Session-scoped capability store for paths returned by trusted dialogs.
 * Existing symlinks are pinned to the target selected at enrollment time;
 * a later retarget therefore invalidates the capability.
 */
export class PathAuthorityStore {
  private readonly enrollments = new Map<string, PathEnrollment>()

  add(filePath: string): void {
    const lexicalPath = resolve(filePath)
    this.enrollments.set(lexicalPath, {
      realPath: tryRealpath(lexicalPath),
      realParent: tryRealpath(dirname(lexicalPath))
    })
  }

  remove(filePath: string): void {
    this.enrollments.delete(resolve(filePath))
  }

  hasEnrollment(filePath: string): boolean {
    return isAbsolute(filePath) && this.enrollments.has(resolve(filePath))
  }

  isAuthorized(filePath: string): boolean {
    if (!isAbsolute(filePath)) return false
    const lexicalPath = resolve(filePath)
    if (lexicalPath !== filePath) return false

    const enrollment = this.enrollments.get(lexicalPath)
    if (enrollment === undefined) return false

    const currentRealPath = tryRealpath(lexicalPath)
    if (enrollment.realPath !== null) {
      return currentRealPath === enrollment.realPath
    }

    // Save dialogs can enroll a path before the file exists. Once created,
    // accept a regular path at the same stable parent, never a new symlink.
    if (currentRealPath === null) return parentIsStable(lexicalPath, enrollment.realParent)
    if (isSymbolicLink(lexicalPath)) return false
    return parentIsStable(lexicalPath, enrollment.realParent)
  }

  clear(): void {
    this.enrollments.clear()
  }
}

function parentIsStable(filePath: string, enrolledParent: string | null): boolean {
  const currentParent = tryRealpath(dirname(filePath))
  return enrolledParent === null ? currentParent === null : currentParent === enrolledParent
}

function tryRealpath(filePath: string): string | null {
  try {
    return realpathSync.native(filePath)
  } catch {
    return null
  }
}

function isSymbolicLink(filePath: string): boolean {
  try {
    return lstatSync(filePath).isSymbolicLink()
  } catch {
    return false
  }
}
