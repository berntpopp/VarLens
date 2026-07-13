import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetDatabasePathAllowlistForTests,
  addAllowedDatabasePath,
  isStrictlyEnrolledDatabasePath
} from '../../../src/main/security/database-path-allowlist'

describe('database-path-allowlist', () => {
  beforeEach(() => __resetDatabasePathAllowlistForTests())

  const symlinkIt = process.platform === 'win32' ? it.skip : it

  symlinkIt('rejects an enrolled symlink after its target is changed', () => {
    const root = mkdtempSync(join(tmpdir(), 'varlens-db-authority-'))
    try {
      const targetA = join(root, 'a.db')
      const targetB = join(root, 'b.db')
      const selected = join(root, 'selected.db')
      writeFileSync(targetA, 'A')
      writeFileSync(targetB, 'B')
      symlinkSync(targetA, selected)

      addAllowedDatabasePath(selected)
      expect(isStrictlyEnrolledDatabasePath(selected)).toBe(true)

      rmSync(selected)
      symlinkSync(targetB, selected)
      expect(isStrictlyEnrolledDatabasePath(selected)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
