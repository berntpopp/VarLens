import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  addAllowedImportPath,
  isAllowedImportPath,
  isStrictlyEnrolledPath,
  __resetAllowlistForTests
} from '../../../src/main/security/import-path-allowlist'

describe('import-path-allowlist', () => {
  beforeEach(() => __resetAllowlistForTests())

  const symlinkIt = process.platform === 'win32' ? it.skip : it

  it('rejects /etc/passwd', () => {
    expect(isAllowedImportPath('/etc/passwd')).toBe(false)
  })

  it('rejects relative paths even when they resolve under an automatic root', () => {
    expect(isAllowedImportPath('relative.bed')).toBe(false)
  })

  it('rejects non-normalized absolute paths containing traversal', () => {
    expect(isAllowedImportPath('/tmp/../etc/shadow')).toBe(false)
  })

  it('accepts a previously-registered dialog path', () => {
    addAllowedImportPath('/some/custom/mount/file.vcf')
    expect(isAllowedImportPath('/some/custom/mount/file.vcf')).toBe(true)
  })

  it('accepts paths under app.getPath(temp) via the env-fallback', () => {
    expect(isAllowedImportPath('/tmp/inside-tmp.bed')).toBe(true)
  })

  symlinkIt('rejects an existing temp symlink that resolves outside allowed roots', () => {
    const root = mkdtempSync(join(tmpdir(), 'varlens-allowlist-'))
    try {
      const linkPath = join(root, 'passwd-link.vcf')
      symlinkSync('/etc/passwd', linkPath)

      expect(isAllowedImportPath(linkPath)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  symlinkIt('rejects a dialog-registered symlink after its target changes', () => {
    const root = mkdtempSync(join(tmpdir(), 'varlens-allowlist-'))
    try {
      const targetA = join(root, 'a.vcf')
      const targetB = join(root, 'b.vcf')
      const linkPath = join(root, 'selected.vcf')
      writeFileSync(targetA, 'A')
      writeFileSync(targetB, 'B')
      symlinkSync(targetA, linkPath)

      addAllowedImportPath(linkPath)
      expect(isAllowedImportPath(linkPath)).toBe(true)

      rmSync(linkPath)
      symlinkSync(targetB, linkPath)
      expect(isAllowedImportPath(linkPath)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  describe('isStrictlyEnrolledPath', () => {
    it('rejects an automatic-root path that was never dialog-enrolled', () => {
      expect(isAllowedImportPath('/tmp/inside-tmp.bed')).toBe(true)
      expect(isStrictlyEnrolledPath('/tmp/inside-tmp.bed')).toBe(false)
    })

    it('accepts an explicitly enrolled normalized absolute path', () => {
      const filePath = '/tmp/dialog-selected.bed'
      addAllowedImportPath(filePath)
      expect(isStrictlyEnrolledPath(filePath)).toBe(true)
    })

    it('rejects relative and non-normalized paths', () => {
      expect(isStrictlyEnrolledPath('relative.bed')).toBe(false)
      expect(isStrictlyEnrolledPath('/tmp/../etc/shadow')).toBe(false)
    })
  })
})
