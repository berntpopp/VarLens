import { describe, expect, it, vi } from 'vitest'

const removed = vi.hoisted(() => ({ dirs: [] as string[], failing: new Set<string>(), next: 0 }))

vi.mock('../../../src/main/import/zip-worker-client', () => ({
  extractZipOffThread: async () => ({ extractedFiles: [], errors: [], totalEntries: 0 }),
  testZipPasswordOffThread: async () => false
}))

// The manager stands in for the remover: it records each removal and fails on demand.
vi.mock('../../../src/main/import', () => ({
  TempDirectoryManager: class {
    private dir = ''
    create(): string {
      removed.next += 1
      this.dir = `/tmp/varlens-zip-${removed.next}`
      return this.dir
    }
    cleanup(): void {
      if (removed.failing.has(this.dir)) throw new Error('directory is busy')
      removed.dirs.push(this.dir)
    }
  }
}))

import {
  cleanupAllZipExtractions,
  cleanupZipTemp,
  extractZip
} from '../../../src/main/ipc/handlers/batch-import-logic'

describe('cleanupAllZipExtractions (#562)', () => {
  it('removes every held extraction, continuing past a failed removal', async () => {
    const first = await extractZip('a.zip')
    await extractZip('b.zip')
    await extractZip('c.zip')
    removed.failing.add('/tmp/varlens-zip-2')

    expect(() => cleanupAllZipExtractions()).not.toThrow()
    expect(removed.dirs).toEqual(['/tmp/varlens-zip-1', '/tmp/varlens-zip-3'])

    // The failed one stays tracked, so a later sweep retries it.
    removed.failing.clear()
    cleanupAllZipExtractions()
    expect(removed.dirs).toEqual(['/tmp/varlens-zip-1', '/tmp/varlens-zip-3', '/tmp/varlens-zip-2'])
    // Already-removed ids are no-ops.
    cleanupZipTemp(first.extractionId)
    expect(removed.dirs).toHaveLength(3)
  })
})
