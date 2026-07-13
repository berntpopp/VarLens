import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, parse, resolve, sep } from 'node:path'
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
  const untrustedPath = join(parse(process.cwd()).root, 'varlens-untrusted', 'file.vcf')
  const automaticTempPath = join(tmpdir(), 'inside-tmp.bed')

  it('rejects a path outside the automatic roots', () => {
    expect(isAllowedImportPath(untrustedPath)).toBe(false)
  })

  it('rejects relative paths even when they resolve under an automatic root', () => {
    expect(isAllowedImportPath('relative.bed')).toBe(false)
  })

  it('rejects non-normalized absolute paths containing traversal', () => {
    expect(isAllowedImportPath(`${tmpdir()}${sep}..${sep}varlens-shadow`)).toBe(false)
  })

  it('accepts a previously-registered dialog path', () => {
    const filePath = resolve(tmpdir(), 'varlens-external', 'file.vcf')
    addAllowedImportPath(filePath)
    expect(isAllowedImportPath(filePath)).toBe(true)
  })

  it('accepts paths under app.getPath(temp) via the env-fallback', () => {
    expect(isAllowedImportPath(automaticTempPath)).toBe(true)
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

  symlinkIt('rejects a dialog-registered symlink after its target is changed', () => {
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

  // F-path hardening (Codex-high finding): isAllowedImportPath's automatic
  // home/userData/temp roots are intentionally permissive for the original
  // import.ts flow, but the DB/BED/batch/shell gates need a strict
  // "dialog-enrolled this session" boundary that does not inherit that
  // grant. isStrictlyEnrolledPath is that boundary.
  describe('isStrictlyEnrolledPath', () => {
    it('rejects a path that isAllowedImportPath only accepts via the automatic temp root', () => {
      // Proves the two predicates diverge: isAllowedImportPath grants the
      // automatic root, isStrictlyEnrolledPath must not inherit that grant.
      expect(isAllowedImportPath(automaticTempPath)).toBe(true)
      expect(isStrictlyEnrolledPath(automaticTempPath)).toBe(false)
    })

    it('rejects a path outside the authority set', () => {
      expect(isStrictlyEnrolledPath(untrustedPath)).toBe(false)
    })

    it('rejects relative paths', () => {
      expect(isStrictlyEnrolledPath('relative.bed')).toBe(false)
    })

    it('rejects non-normalized absolute paths containing traversal', () => {
      expect(isStrictlyEnrolledPath(`${tmpdir()}${sep}..${sep}varlens-shadow`)).toBe(false)
    })

    it('accepts a previously-registered dialog path', () => {
      const filePath = resolve(tmpdir(), 'varlens-external', 'file.vcf')
      addAllowedImportPath(filePath)
      expect(isStrictlyEnrolledPath(filePath)).toBe(true)
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

    symlinkIt('rejects a dialog-registered symlink after its target is changed', () => {
      const root = mkdtempSync(join(tmpdir(), 'varlens-allowlist-'))
      try {
        const targetA = join(root, 'a.vcf')
        const targetB = join(root, 'b.vcf')
        const linkPath = join(root, 'selected.vcf')
        writeFileSync(targetA, 'A')
        writeFileSync(targetB, 'B')
        symlinkSync(targetA, linkPath)

        addAllowedImportPath(linkPath)
        expect(isStrictlyEnrolledPath(linkPath)).toBe(true)

        rmSync(linkPath)
        symlinkSync(targetB, linkPath)
        expect(isStrictlyEnrolledPath(linkPath)).toBe(false)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })
  })
})
