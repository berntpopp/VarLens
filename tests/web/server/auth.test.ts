import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  resolveDefaultRevocationsPath,
  SessionRevocations
} from '../../../src/web/server/session-revocation'

describe('resolveDefaultRevocationsPath determinism (#661)', () => {
  it('returns the exact same path before and after recovery directory creation', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'varlens-auth-test-'))
    const recoveryDir = join(tempDir, 'recovery')

    try {
      expect(existsSync(recoveryDir)).toBe(false)

      const env: NodeJS.ProcessEnv = {
        VARLENS_RECOVERY_KEY_DIR: recoveryDir
      }

      // First boot: directory does not exist on disk
      const pathFirstBoot = resolveDefaultRevocationsPath(env)
      expect(pathFirstBoot).toBe(join(recoveryDir, 'web-revoked-sessions.json'))

      // Simulate directory creation (e.g. by auth.ts loadOrCreateSessionKey or SessionRevocations.save)
      mkdirSync(recoveryDir, { recursive: true, mode: 0o700 })
      expect(existsSync(recoveryDir)).toBe(true)

      // Subsequent boot: directory exists on disk
      const pathSubsequentBoot = resolveDefaultRevocationsPath(env)
      expect(pathSubsequentBoot).toBe(pathFirstBoot)

      // SessionRevocations correctly saves and reloads across boots
      const rev1 = new SessionRevocations(60_000, 10, Date.now, pathFirstBoot)
      rev1.revoke('session-123')
      expect(rev1.isRevoked('session-123')).toBe(true)

      const rev2 = new SessionRevocations(60_000, 10, Date.now, pathSubsequentBoot)
      expect(rev2.isRevoked('session-123')).toBe(true)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('does not depend on existsSync(/data) when default /data is used', () => {
    const env: NodeJS.ProcessEnv = {}
    const path = resolveDefaultRevocationsPath(env)
    expect(path).toBe(join('/data', 'web-revoked-sessions.json'))
  })
})
