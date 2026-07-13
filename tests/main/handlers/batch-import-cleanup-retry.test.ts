import { describe, expect, it, vi } from 'vitest'

const cleanupState = vi.hoisted(() => ({
  calls: 0,
  failNext: true,
  nextDirectory: 0
}))

vi.mock('../../../src/main/import', () => ({
  ZipExtractor: class {
    async extract(zipPath: string): Promise<{
      extractedFiles: string[]
      errors: string[]
      totalEntries: number
    }> {
      if (zipPath === 'broken.zip') throw new Error('archive decode failed')
      return { extractedFiles: [], errors: [], totalEntries: 0 }
    }
  },
  TempDirectoryManager: class {
    create(): string {
      cleanupState.nextDirectory += 1
      return `/tmp/mock-zip-${cleanupState.nextDirectory}`
    }

    cleanup(): void {
      cleanupState.calls += 1
      if (cleanupState.failNext) {
        cleanupState.failNext = false
        throw new Error('directory is busy')
      }
    }
  }
}))

import { cleanupZipTemp, extractZip } from '../../../src/main/ipc/handlers/batch-import-logic'

describe('batch-import orphaned ZIP cleanup', () => {
  it('retries an unreturned extraction cleanup before accepting another extraction', async () => {
    await expect(extractZip('broken.zip')).rejects.toThrow(/cleanup also failed/)
    expect(cleanupState.calls).toBe(1)

    const next = await extractZip('next.zip')

    expect(cleanupState.calls).toBe(2)
    cleanupZipTemp(next.extractionId)
    expect(cleanupState.calls).toBe(3)
  })
})
