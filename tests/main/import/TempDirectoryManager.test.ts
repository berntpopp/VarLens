import { describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import type { rmSync } from 'node:fs'

import { TempDirectoryManager } from '../../../src/main/import/TempDirectoryManager'

describe('TempDirectoryManager cleanup', () => {
  it('propagates removal failure and retains the directory for a retry', () => {
    const remove = vi
      .fn<typeof rmSync>()
      .mockImplementationOnce(() => {
        throw new Error('file is busy')
      })
      .mockImplementationOnce(() => undefined)
    const manager = new TempDirectoryManager(remove)
    const directory = manager.create()

    expect(() => manager.cleanup()).toThrow(/file is busy/)
    expect(manager.getPath()).toBe(directory)
    expect(existsSync(directory)).toBe(true)

    manager.cleanup()
    expect(manager.getPath()).toBeNull()
    expect(remove).toHaveBeenCalledTimes(2)
    expect(remove).toHaveBeenCalledWith(directory, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100
    })
  })
})
