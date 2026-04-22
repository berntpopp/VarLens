import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { resolveLinuxPackagedBinary } from '../../e2e/helpers/packaged-electron-app'

describe('resolveLinuxPackagedBinary', () => {
  const createdDirs: string[] = []

  afterEach(() => {
    for (const dir of createdDirs) {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    }
    createdDirs.length = 0
  })

  function makeReleaseDir(layout: { unpackedBinary?: boolean; otherFiles?: string[] }): string {
    const root = mkdtempSync(join(tmpdir(), 'varlens-packaged-test-'))
    const release = join(root, 'release')
    mkdirSync(release, { recursive: true })
    if (layout.unpackedBinary === true) {
      const unpackedDir = join(release, 'linux-unpacked')
      mkdirSync(unpackedDir, { recursive: true })
      writeFileSync(join(unpackedDir, 'varlens'), 'placeholder')
    }
    for (const name of layout.otherFiles ?? []) {
      writeFileSync(join(release, name), 'placeholder')
    }
    createdDirs.push(root)
    return root
  }

  it('returns the unpacked Electron binary path when present', () => {
    const root = makeReleaseDir({ unpackedBinary: true, otherFiles: ['Varlens-0.56.5.AppImage'] })
    const resolved = resolveLinuxPackagedBinary(root)
    expect(resolved).toBe(join(root, 'release', 'linux-unpacked', 'varlens'))
  })

  it('throws when release/ is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'varlens-packaged-test-'))
    createdDirs.push(root)
    expect(() => resolveLinuxPackagedBinary(root)).toThrow(/release\/ does not exist/)
  })

  it('throws when linux-unpacked/varlens is missing', () => {
    const root = makeReleaseDir({ unpackedBinary: false, otherFiles: ['Varlens-0.56.5.AppImage'] })
    expect(() => resolveLinuxPackagedBinary(root)).toThrow(
      /Expected .*linux-unpacked\/varlens to exist/
    )
  })
})
