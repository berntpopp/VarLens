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

  function makeReleaseDir(files: string[]): string {
    const root = mkdtempSync(join(tmpdir(), 'varlens-packaged-test-'))
    const release = join(root, 'release')
    mkdirSync(release, { recursive: true })
    for (const name of files) {
      writeFileSync(join(release, name), 'placeholder')
    }
    createdDirs.push(root)
    return root
  }

  it('returns the path to the AppImage when present', () => {
    const root = makeReleaseDir(['Varlens-0.56.5.AppImage', 'Varlens-0.56.5.deb'])
    const resolved = resolveLinuxPackagedBinary(root)
    expect(resolved).toBe(join(root, 'release', 'Varlens-0.56.5.AppImage'))
  })

  it('throws when release/ is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'varlens-packaged-test-'))
    createdDirs.push(root)
    expect(() => resolveLinuxPackagedBinary(root)).toThrow(/release\/ does not exist/)
  })

  it('throws when no AppImage is produced', () => {
    const root = makeReleaseDir(['Varlens-0.56.5.deb'])
    expect(() => resolveLinuxPackagedBinary(root)).toThrow(/No \.AppImage found/)
  })
})
