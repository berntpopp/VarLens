import { describe, expect, it, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import {
  TempDirectoryManager,
  sweepStaleZipTempDirs
} from '../../../src/main/import/TempDirectoryManager'

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

describe('sweepStaleZipTempDirs (#562)', () => {
  const HOUR = 60 * 60 * 1000

  function fakeTempRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'varlens-sweep-test-'))
    for (const name of ['varlens-zip-old', 'varlens-zip-fresh', 'other-app']) {
      mkdirSync(join(root, name))
      writeFileSync(join(root, name, 'case.vcf'), 'x')
    }
    // A plain file with the prefix is not an extraction folder.
    writeFileSync(join(root, 'varlens-zip-file'), 'x')
    const old = new Date(Date.now() - 2 * HOUR)
    utimesSync(join(root, 'varlens-zip-old'), old, old)
    utimesSync(join(root, 'other-app'), old, old)
    return root
  }

  it('removes stale varlens-zip-* folders and leaves everything else alone', () => {
    const root = fakeTempRoot()
    try {
      sweepStaleZipTempDirs(root)
      expect(readdirSync(root).sort()).toEqual([
        'other-app',
        'varlens-zip-file',
        'varlens-zip-fresh'
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps sweeping after one removal fails', () => {
    const root = fakeTempRoot()
    mkdirSync(join(root, 'varlens-zip-old2'))
    const old = new Date(Date.now() - 2 * HOUR)
    utimesSync(join(root, 'varlens-zip-old2'), old, old)
    const remove = vi.fn<typeof rmSync>().mockImplementationOnce(() => {
      throw new Error('busy')
    })
    try {
      sweepStaleZipTempDirs(root, Date.now(), remove)
      expect(remove.mock.calls.map(([path]) => basename(String(path))).sort()).toEqual([
        'varlens-zip-old',
        'varlens-zip-old2'
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
