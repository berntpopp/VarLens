import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
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

  symlinkIt('accepts a dialog-registered symlink and its resolved target', () => {
    const root = mkdtempSync(join(tmpdir(), 'varlens-allowlist-'))
    try {
      const linkPath = join(root, 'passwd-link.vcf')
      symlinkSync('/etc/passwd', linkPath)
      const targetPath = realpathSync.native(linkPath)

      addAllowedImportPath(linkPath)

      expect(isAllowedImportPath(linkPath)).toBe(true)
      expect(isAllowedImportPath(targetPath)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  // F-path hardening (Codex-high finding): isAllowedImportPath's automatic
  // home/userData/temp roots are intentionally permissive for the original
  // import.ts flow, but the DB/BED/batch/shell gates need a strict
  // "dialog-enrolled this session" boundary that does not inherit that
  // grant. isStrictlyEnrolledPath is that boundary.
  describe('isStrictlyEnrolledPath', () => {
    it('rejects a path that isAllowedImportPath only accepts via the automatic temp root', () => {
      // Proves the two predicates diverge: isAllowedImportPath grants the
      // automatic root, isStrictlyEnrolledPath must not inherit that grant.
      expect(isAllowedImportPath('/tmp/inside-tmp.bed')).toBe(true)
      expect(isStrictlyEnrolledPath('/tmp/inside-tmp.bed')).toBe(false)
    })

    it('rejects /etc/passwd', () => {
      expect(isStrictlyEnrolledPath('/etc/passwd')).toBe(false)
    })

    it('rejects relative paths', () => {
      expect(isStrictlyEnrolledPath('relative.bed')).toBe(false)
    })

    it('rejects non-normalized absolute paths containing traversal', () => {
      expect(isStrictlyEnrolledPath('/tmp/../etc/shadow')).toBe(false)
    })

    it('accepts a previously-registered dialog path', () => {
      addAllowedImportPath('/some/custom/mount/file.vcf')
      expect(isStrictlyEnrolledPath('/some/custom/mount/file.vcf')).toBe(true)
    })

    symlinkIt('rejects an existing temp symlink that was never dialog-enrolled', () => {
      const root = mkdtempSync(join(tmpdir(), 'varlens-allowlist-'))
      try {
        const linkPath = join(root, 'passwd-link.vcf')
        symlinkSync('/etc/passwd', linkPath)

        expect(isStrictlyEnrolledPath(linkPath)).toBe(false)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })

    symlinkIt('accepts a dialog-registered symlink and its resolved target', () => {
      const root = mkdtempSync(join(tmpdir(), 'varlens-allowlist-'))
      try {
        const linkPath = join(root, 'passwd-link.vcf')
        symlinkSync('/etc/passwd', linkPath)
        const targetPath = realpathSync.native(linkPath)

        addAllowedImportPath(linkPath)

        expect(isStrictlyEnrolledPath(linkPath)).toBe(true)
        expect(isStrictlyEnrolledPath(targetPath)).toBe(true)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })
  })
})
