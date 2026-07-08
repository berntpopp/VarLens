/**
 * recovery-sidecar.ts -- direct unit coverage.
 *
 * `db-key-store.test.ts`'s "recovery sidecar portability" block already
 * exercises `writeRecoverySidecar` indirectly through `DbKeyStore`. This
 * file covers the module directly, plus the power-loss durability
 * requirement: the sidecar write must fsync its temp file before the rename
 * that makes it live, and best-effort fsync the containing directory after.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { PassphraseWrap } from '../../../src/main/database/db-key-store'
import {
  readRecoverySidecar,
  recoverySidecarExists,
  recoverySidecarPathFor,
  writeRecoverySidecar
} from '../../../src/main/database/recovery-sidecar'

const passWrap: PassphraseWrap = {
  saltB64: 'c2FsdA==',
  ivB64: 'aXY=',
  ctB64: 'Y3Q=',
  tagB64: 'dGFn'
}

describe('recovery-sidecar', () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'varlens-recovery-sidecar-'))
    dbPath = join(tmpDir, 'case.db')
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('writes a sidecar that readRecoverySidecar reads back with the same passWrap', () => {
    writeRecoverySidecar(dbPath, passWrap)

    expect(recoverySidecarExists(dbPath)).toBe(true)
    const sidecar = readRecoverySidecar(dbPath)
    expect(sidecar).not.toBeNull()
    expect(sidecar?.passWrap).toEqual(passWrap)
  })

  it('readRecoverySidecar returns null for a missing sidecar', () => {
    expect(readRecoverySidecar(dbPath)).toBeNull()
  })

  it('readRecoverySidecar tolerates a corrupt sidecar file (returns null, never throws)', () => {
    const sidecarPath = recoverySidecarPathFor(dbPath)
    writeFileSync(sidecarPath, 'not json', 'utf-8')

    expect(() => readRecoverySidecar(dbPath)).not.toThrow()
    expect(readRecoverySidecar(dbPath)).toBeNull()
  })

  describe('write durability (power-loss safety)', () => {
    afterEach(() => {
      vi.doUnmock('fs')
      vi.resetModules()
    })

    it('fsyncs the temp file before the rename, and best-effort fsyncs the directory after it', async () => {
      const calls: string[] = []
      vi.resetModules()
      vi.doMock('fs', async (importOriginal) => {
        const actual = await importOriginal<typeof import('fs')>()
        return {
          ...actual,
          fsyncSync: vi.fn((...args: Parameters<typeof actual.fsyncSync>) => {
            calls.push('fsync')
            return actual.fsyncSync(...args)
          }),
          renameSync: vi.fn((...args: Parameters<typeof actual.renameSync>) => {
            calls.push('rename')
            return actual.renameSync(...args)
          })
        }
      })

      const { writeRecoverySidecar: freshWriteRecoverySidecar } =
        await import('../../../src/main/database/recovery-sidecar')
      freshWriteRecoverySidecar(dbPath, passWrap)

      // At least two fsyncs: the temp file (blocking) and the containing
      // directory (best-effort) -- and the file fsync must precede the
      // rename that makes the write visible.
      expect(calls.filter((c) => c === 'fsync').length).toBeGreaterThanOrEqual(2)
      expect(calls[0]).toBe('fsync')
      expect(calls).toContain('rename')
      expect(calls.indexOf('fsync')).toBeLessThan(calls.indexOf('rename'))
    })

    it('the sidecar is durably on disk immediately after writeRecoverySidecar returns', () => {
      writeRecoverySidecar(dbPath, passWrap)

      const sidecarPath = recoverySidecarPathFor(dbPath)
      expect(existsSync(sidecarPath)).toBe(true)
      const onDisk = JSON.parse(readFileSync(sidecarPath, 'utf-8')) as { passWrap: PassphraseWrap }
      expect(onDisk.passWrap).toEqual(passWrap)
    })
  })
})
