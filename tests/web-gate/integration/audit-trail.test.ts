import { describe, expect, test } from 'vitest'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { Pool } from 'pg'

import { SAME_ORIGIN_HEADERS, startWebDriver } from '../helpers/web-driver'

/**
 * Audit-trail end-to-end (spec .planning/specs/2026-06-10-audit-schema-isolation.md).
 *
 * The dispatcher audit tests run against mocked executors and the
 * real-Postgres audit tests bypass HTTP. This test closes the gap: a live
 * buildApp instance against a real Postgres, asserting that HTTP requests
 * leave rows in varlens_audit.audit_log stamped with the project schema —
 * and that the admin gate on audit reads holds over the real stack.
 *
 *   1. Driver bootstraps an admin (login + rotation are themselves audited).
 *   2. Admin performs a write (tags:create) and a read (tags:list).
 *   3. A failed login attempt is recorded without a username.
 *   4. Admin reads the trail over HTTP — allowed, and itself audited.
 *   5. A non-admin user (inserted directly; auth:createUser is 501 in this
 *      single-tenant release) logs in and gets 403 on audit:query.
 *
 * Gated on the web build + Postgres availability.
 */

const WEB_BUILD_PATH = resolve(process.cwd(), 'out/web/server.cjs')
const isWebBuilt = existsSync(WEB_BUILD_PATH)
const PG_URL = process.env.VARLENS_PG_URL ?? ''
const HAS_PG = PG_URL !== ''

const ANALYST_PASSWORD = 'analyst-active-password-2026'

interface InjectResult {
  statusCode: number
  body: string
  headers: Record<string, string | string[] | undefined>
  json: () => unknown
}

interface AuditRow {
  action_type: string
  entity_key: string
  user_name: string | null
}

function extractCookies(res: InjectResult): string {
  const setCookie = res.headers['set-cookie']
  if (setCookie === undefined) return ''
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie]
  return arr.map((c) => String(c).split(';')[0]).join('; ')
}

describe.skipIf(!isWebBuilt || !HAS_PG)('audit trail end-to-end', () => {
  test('HTTP actions persist to varlens_audit.audit_log and audit reads stay admin-gated', async () => {
    const driver = await startWebDriver()
    const pool = new Pool({ connectionString: PG_URL, max: 2 })
    try {
      // 2: an autorouted write and an autorouted read through the live stack.
      const write = (await driver.api('tags', 'create', 'Reviewed', '#336699')) as InjectResult
      expect(write.statusCode, write.body).toBe(200)
      const read = (await driver.api('tags', 'list')) as InjectResult
      expect(read.statusCode, read.body).toBe(200)

      // 3: a failed login attempt (public route, no session).
      const failedLogin = (await driver.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { args: ['web-gate-admin', 'wrong-password'] },
        headers: SAME_ORIGIN_HEADERS
      })) as unknown as InjectResult
      expect(failedLogin.statusCode).toBe(200)
      expect((failedLogin.json() as { success: boolean }).success).toBe(false)

      // 4: the admin reads the trail over HTTP.
      const auditRes = (await driver.api('audit', 'query', { limit: 100 })) as InjectResult
      expect(auditRes.statusCode, auditRes.body).toBe(200)
      const auditBody = auditRes.json() as { data: AuditRow[]; total_count: number }
      expect(auditBody.total_count).toBeGreaterThan(0)

      // DB-level proof: the rows exist in the central table, stamped with
      // this driver's project schema, attributed to the acting user.
      // Read audits are batched (AuditBuffer, flushed every 250 ms by default),
      // so the audit:query self-audit row lands shortly after the response.
      // Poll briefly instead of asserting on the first read.
      const readTrail = () =>
        pool.query<AuditRow>(
          `SELECT action_type, entity_key, user_name
             FROM varlens_audit.audit_log
            WHERE project_schema = $1
            ORDER BY id`,
          [driver.schema]
        )
      let rows = await readTrail()
      const has = (action: string, entityKey: string, userName: string | null): boolean =>
        rows.rows.some(
          (r) => r.action_type === action && r.entity_key === entityKey && r.user_name === userName
        )
      for (let i = 0; i < 30 && !has('api_read', 'audit:query', 'web-gate-admin'); i++) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        rows = await readTrail()
      }

      expect(has('auth_login_success', 'web-gate-admin', 'web-gate-admin'), 'login').toBe(true)
      expect(has('auth_password_change', 'web-gate-admin', 'web-gate-admin'), 'rotation').toBe(true)
      // Failed logins are recorded without the attempted username (it may
      // contain a mistyped password) — entity_key is the fixed marker.
      expect(has('auth_login_failure', 'login-attempt', null), 'failed login').toBe(true)
      expect(has('api_write', 'tags:create', 'web-gate-admin'), 'write audit').toBe(true)
      expect(has('api_read', 'tags:list', 'web-gate-admin'), 'read audit').toBe(true)
      // Reading the trail is itself an audited access.
      expect(has('api_read', 'audit:query', 'web-gate-admin'), 'self audit').toBe(true)

      // 5: a non-admin gets 403 on the same endpoint over the live stack.
      const { defaultPasswordProvider } =
        await import('../../../src/main/auth/providers/argon2-provider')
      const analystHash = await defaultPasswordProvider.hashPassword(ANALYST_PASSWORD)
      await pool.query(
        `INSERT INTO "${driver.schema}".users
          (username, display_name, password_hash, role, is_active, must_change_password, password_changed_at)
         VALUES ('analyst', 'Analyst', $1, 'user', TRUE, FALSE, now())`,
        [analystHash]
      )

      const analystLogin = (await driver.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { args: ['analyst', ANALYST_PASSWORD] },
        headers: SAME_ORIGIN_HEADERS
      })) as unknown as InjectResult
      expect(analystLogin.statusCode, analystLogin.body).toBe(200)
      expect((analystLogin.json() as { success: boolean }).success).toBe(true)
      const analystCookie = extractCookies(analystLogin)
      expect(analystCookie).not.toBe('')

      const blocked = (await driver.app.inject({
        method: 'POST',
        url: '/api/audit/query',
        payload: { args: [{ limit: 10 }] },
        headers: { ...SAME_ORIGIN_HEADERS, cookie: analystCookie }
      })) as unknown as InjectResult
      expect(blocked.statusCode).toBe(403)
      expect(blocked.json()).toMatchObject({ details: { error: 'admin-required' } })

      // The blocked attempt must not have produced an api_read row. Wait past
      // one audit-buffer flush interval so a buffered row would have landed.
      await new Promise((resolve) => setTimeout(resolve, 400))
      const blockedRead = await pool.query(
        `SELECT 1 FROM varlens_audit.audit_log
          WHERE project_schema = $1 AND action_type = 'api_read'
            AND entity_key = 'audit:query' AND user_name = 'analyst'`,
        [driver.schema]
      )
      expect(blockedRead.rows).toHaveLength(0)
    } finally {
      // The central trail outlives the project schema by design; clean this
      // run's rows the way retention does — owner-only trigger disable.
      try {
        await pool.query(
          'ALTER TABLE varlens_audit.audit_log DISABLE TRIGGER audit_log_block_mutation'
        )
        await pool.query('DELETE FROM varlens_audit.audit_log WHERE project_schema = $1', [
          driver.schema
        ])
      } finally {
        await pool.query(
          'ALTER TABLE varlens_audit.audit_log ENABLE TRIGGER audit_log_block_mutation'
        )
        await pool.end()
        await driver.close()
      }
    }
  }, 60_000)
})

describe.skipIf(isWebBuilt && HAS_PG)('audit trail end-to-end (skipped)', () => {
  test('runs only with out/web/server.cjs built and VARLENS_PG_URL set', () => {
    expect(isWebBuilt && HAS_PG).toBe(false)
  })
})
