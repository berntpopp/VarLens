import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export class TempDirectoryManager {
  private tempDir: string | null = null

  create(): string {
    this.tempDir = mkdtempSync(join(tmpdir(), 'varlens-zip-'))
    return this.tempDir
  }

  cleanup(): void {
    if (this.tempDir !== null) {
      try {
        rmSync(this.tempDir, { recursive: true, force: true })
      } catch (error) {
        console.error('Failed to clean up temp directory:', error)
      }
      this.tempDir = null
    }
  }

  getPath(): string | null {
    return this.tempDir
  }
}
