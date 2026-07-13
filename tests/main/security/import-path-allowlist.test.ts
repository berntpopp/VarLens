import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, parse, resolve, sep } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  addAllowedImportPath,
  isStrictlyEnrolledPath,
  __resetAllowlistForTests
} from '../../../src/main/security/import-path-allowlist'

describe('import-path-allowlist', () => {
  beforeEach(() => __resetAllowlistForTests())

  const symlinkIt = process.platform === 'win32' ? it.skip : it
  const untrustedPath = join(parse(process.cwd()).root, 'varlens-untrusted', 'file.vcf')
  const unenrolledTempPath = join(tmpdir(), 'inside-tmp.bed')

  it('rejects a path that was never enrolled', () => {
    expect(isStrictlyEnrolledPath(untrustedPath)).toBe(false)
  })

  it('rejects relative paths even when they resolve under temp', () => {
    expect(isStrictlyEnrolledPath('relative.bed')).toBe(false)
  })

  it('rejects non-normalized absolute paths containing traversal', () => {
    expect(isStrictlyEnrolledPath(`${tmpdir()}${sep}..${sep}varlens-shadow`)).toBe(false)
  })

  it.each([
    ['relative', 'relative.bed', resolve('relative.bed')],
    [
      'non-normalized absolute',
      `${tmpdir()}${sep}..${sep}varlens-shadow`,
      resolve(`${tmpdir()}${sep}..${sep}varlens-shadow`)
    ]
  ])('does not enroll a %s path through its normalized alias', (_kind, candidate, alias) => {
    addAllowedImportPath(candidate)

    expect(isStrictlyEnrolledPath(alias)).toBe(false)
  })

  it('accepts a previously-registered dialog path', () => {
    const filePath = resolve(tmpdir(), 'varlens-external', 'file.vcf')
    addAllowedImportPath(filePath)
    expect(isStrictlyEnrolledPath(filePath)).toBe(true)
  })

  it.each([
    ['temp', unenrolledTempPath],
    ['home', join(homedir(), 'varlens-unenrolled', 'inside-home.vcf')]
  ])('rejects an unenrolled path under %s', (_root, filePath) => {
    expect(isStrictlyEnrolledPath(filePath)).toBe(false)
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
