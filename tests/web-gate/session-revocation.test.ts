import { describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  resolveDefaultRevocationsPath,
  SessionRevocations
} from '../../src/web/server/session-revocation'

describe('resolveDefaultRevocationsPath', () => {
  it('prefers VARLENS_REVOKED_SESSIONS_PATH if specified', () => {
    const custom = '/custom/path/revocations.json'
    expect(
      resolveDefaultRevocationsPath({
        VARLENS_REVOKED_SESSIONS_PATH: custom
      } as NodeJS.ProcessEnv)
    ).toBe(custom)
  })

  it('uses VARLENS_RECOVERY_KEY_DIR if set to absolute path', () => {
    const dir = '/absolute/recovery'
    expect(
      resolveDefaultRevocationsPath({
        VARLENS_RECOVERY_KEY_DIR: dir
      } as NodeJS.ProcessEnv)
    ).toBe(join(dir, 'web-revoked-sessions.json'))
  })

  it('falls back to deterministic tmpdir path when /data is absent and no env set', () => {
    const path1 = resolveDefaultRevocationsPath({
      VARLENS_SESSION_SECRET_HEX: '0123456789abcdef'
    } as NodeJS.ProcessEnv)
    const path2 = resolveDefaultRevocationsPath({
      VARLENS_SESSION_SECRET_HEX: '0123456789abcdef'
    } as NodeJS.ProcessEnv)
    expect(path1).toBe(path2)
    expect(path1.startsWith(tmpdir())).toBe(true)
    expect(path1).toContain('varlens-revocations-')
    expect(path1.endsWith('.json')).toBe(true)
  })
})

describe('SessionRevocations fail-closed persistence', () => {
  it('throws on startup if revocations file is corrupt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'varlens-revoc-corrupt-'))
    const filePath = join(dir, 'revocations.json')
    try {
      writeFileSync(filePath, '{ invalid json: corrupt content', 'utf8')
      expect(() => new SessionRevocations(60_000, 10, Date.now, filePath)).toThrow(
        /Failed to load revoked sessions/
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('throws during revoke if persistence write fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'varlens-revoc-readonly-'))
    const filePath = join(dir, 'revocations.json')
    try {
      const revocations = new SessionRevocations(60_000, 10, Date.now, filePath)
      // Make directory read-only so write fails
      chmodSync(dir, 0o500)
      expect(() => revocations.revoke('sid-fail')).toThrow(/Failed to persist revoked sessions/)
    } finally {
      chmodSync(dir, 0o700)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('correctly persists and reloads valid revocations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'varlens-revoc-valid-'))
    const filePath = join(dir, 'revocations.json')
    try {
      const now = 1000
      const r1 = new SessionRevocations(60_000, 10, () => now, filePath)
      r1.revoke('sid-valid-1')
      expect(r1.isRevoked('sid-valid-1')).toBe(true)

      const r2 = new SessionRevocations(60_000, 10, () => now, filePath)
      expect(r2.isRevoked('sid-valid-1')).toBe(true)
      expect(r2.isRevoked('sid-valid-2')).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
