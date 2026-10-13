import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mainLogger } from '../services/MainLogger'

const ZIP_TEMP_PREFIX = 'varlens-zip-'
const REMOVE_OPTIONS = { recursive: true, force: true, maxRetries: 3, retryDelay: 100 } as const
// ponytail: another desktop instance with its own userData (dev vs installed app)
// does not share our single-instance lock; the age floor spares its live extraction.
const STALE_ZIP_TEMP_MIN_AGE_MS = 60 * 60 * 1000

/**
 * Remove ZIP extraction folders (decrypted patient files) left behind by a crash
 * or a killed quit (#562). Desktop main process only: the web server shares the
 * prefix in the same temp folder.
 */
export function sweepStaleZipTempDirs(
  root: string = tmpdir(),
  now: number = Date.now(),
  removeDirectory: typeof rmSync = rmSync
): void {
  let names: string[]
  try {
    names = readdirSync(root).filter((name) => name.startsWith(ZIP_TEMP_PREFIX))
  } catch (error) {
    mainLogger.warn(`Could not list temp folder for ZIP cleanup: ${error}`, 'import')
    return
  }
  for (const name of names) {
    const path = join(root, name)
    try {
      const stats = statSync(path)
      if (!stats.isDirectory() || now - stats.mtimeMs < STALE_ZIP_TEMP_MIN_AGE_MS) continue
      removeDirectory(path, REMOVE_OPTIONS)
      mainLogger.info(`Removed stale ZIP extraction ${path}`, 'import')
    } catch (error) {
      mainLogger.error(`Failed to remove stale ZIP extraction ${path}: ${error}`, 'import')
    }
  }
}

export class TempDirectoryManager {
  private tempDir: string | null = null

  constructor(private readonly removeDirectory: typeof rmSync = rmSync) {}

  create(): string {
    this.tempDir = mkdtempSync(join(tmpdir(), ZIP_TEMP_PREFIX))
    return this.tempDir
  }

  cleanup(): void {
    if (this.tempDir !== null) {
      try {
        this.removeDirectory(this.tempDir, REMOVE_OPTIONS)
      } catch (error) {
        mainLogger.error(`Failed to clean up temp directory: ${error}`, 'import')
        // Retain the path so a later cleanup attempt can retry. Reporting
        // success and forgetting the directory would orphan extracted clinical
        // data, especially on Windows where transient open handles can make a
        // recursive removal fail.
        throw new Error(
          `Failed to clean up temporary ZIP directory: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { cause: error }
        )
      }
      this.tempDir = null
    }
  }

  getPath(): string | null {
    return this.tempDir
  }
}
