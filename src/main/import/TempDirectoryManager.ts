import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mainLogger } from '../services/MainLogger'

export class TempDirectoryManager {
  private tempDir: string | null = null

  constructor(private readonly removeDirectory: typeof rmSync = rmSync) {}

  create(): string {
    this.tempDir = mkdtempSync(join(tmpdir(), 'varlens-zip-'))
    return this.tempDir
  }

  cleanup(): void {
    if (this.tempDir !== null) {
      try {
        this.removeDirectory(this.tempDir, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 100
        })
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
