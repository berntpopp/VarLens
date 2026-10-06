import { describe, expect, test } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { fork } from 'child_process'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { Pool } from 'pg'

/**
 * Buffered read audits must survive a graceful shutdown.
 *
 * `api_read` rows are batched in memory (src/web/server/audit-buffer.ts).
 * This test runs the BUILT server with a 10 s flush interval (the maximum) so every row
 * is guaranteed to still be pending, performs N authenticated reads over a
 * real socket, sends SIGTERM, and asserts that all N rows reached
 * varlens_audit.audit_log before the process exited.
 *
 * Gated on the web build + Postgres availability.
 */

const WEB_BUILD_PATH = resolve(process.cwd(), 'out/web/server.cjs')
const isWebBuilt = existsSync(WEB_BUILD_PATH)
const PG_URL = process.env.VARLENS_PG_URL ?? ''
const HAS_PG = PG_URL !== ''
const READS = 25
const ADMIN = 'sigterm-audit-admin'
const PASSWORD = 'sigterm-audit-password-2026'

function cookieFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
}

describe.skipIf(!isWebBuilt || !HAS_PG)('buffered audit rows on SIGTERM', () => {
  test('every buffered api_read row is flushed before the process exits', async () => {
    const schema = `audit_sigterm_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
    const recoveryDir = mkdtempSync(join(tmpdir(), 'varlens-audit-sigterm-'))
    const pool = new Pool({ connectionString: PG_URL, max: 2 })
    const { defaultPasswordProvider } =
      await import('../../../src/main/auth/providers/argon2-provider')
    const passwordHash = await defaultPasswordProvider.hashPassword(PASSWORD)

    const child = fork(WEB_BUILD_PATH, [], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        VARLENS_WEB_PORT: '0',
        VARLENS_WEB_HOST: '127.0.0.1',
        VARLENS_METRICS_ENABLED: '0',
        VARLENS_PG_SCHEMA: schema,
        VARLENS_RECOVERY_KEY_DIR: recoveryDir,
        VARLENS_ADMIN_USERNAME: ADMIN,
        VARLENS_ADMIN_PASSWORD_HASH: passwordHash,
        VARLENS_ADMIN_MUST_CHANGE_PASSWORD: 'false',
        VARLENS_AUDIT_FLUSH_INTERVAL_MS: '10000',
        VARLENS_AUDIT_BATCH_SIZE: '1000'
      },
      stdio: 'pipe'
    })

    try {
      const port = await new Promise<number>((res, rej) => {
        const timeout = setTimeout(() => rej(new Error('child did not announce port')), 20_000)
        child.stdout?.on('data', (chunk: Buffer) => {
          for (const line of chunk.toString('utf8').split('\n')) {
            try {
              const parsed = JSON.parse(line) as Record<string, unknown>
              if (typeof parsed.port === 'number' && parsed.msg === 'listening') {
                clearTimeout(timeout)
                res(parsed.port)
              }
            } catch {
              // not a JSON log line
            }
          }
        })
      })
      const base = `http://127.0.0.1:${port}`
      const headers = { 'content-type': 'application/json', origin: base }

      const login = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ args: [ADMIN, PASSWORD] })
      })
      expect(login.status).toBe(200)
      const cookie = cookieFrom(login)
      expect(cookie).not.toBe('')

      for (let i = 0; i < READS; i++) {
        const res = await fetch(`${base}/api/tags/list`, {
          method: 'POST',
          headers: { ...headers, cookie },
          body: JSON.stringify({ args: [] })
        })
        expect(res.status).toBe(200)
      }

      const beforeExit = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM varlens_audit.audit_log
          WHERE project_schema = $1 AND action_type = 'api_read' AND entity_key = 'tags:list'`,
        [schema]
      )
      // Proves the rows really were buffered (not yet written) at SIGTERM time.
      expect(Number(beforeExit.rows[0].n)).toBe(0)

      child.kill('SIGTERM')
      const exitCode = await new Promise<number | null>((res) => child.once('exit', res))
      expect(exitCode).toBe(0)

      const afterExit = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM varlens_audit.audit_log
          WHERE project_schema = $1 AND action_type = 'api_read' AND entity_key = 'tags:list'`,
        [schema]
      )
      expect(Number(afterExit.rows[0].n)).toBe(READS)
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL')
      try {
        await pool.query(
          'ALTER TABLE varlens_audit.audit_log DISABLE TRIGGER audit_log_block_mutation'
        )
        await pool.query('DELETE FROM varlens_audit.audit_log WHERE project_schema = $1', [schema])
      } finally {
        await pool.query(
          'ALTER TABLE varlens_audit.audit_log ENABLE TRIGGER audit_log_block_mutation'
        )
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await pool.end()
        rmSync(recoveryDir, { recursive: true, force: true })
      }
    }
  }, 60_000)
})
