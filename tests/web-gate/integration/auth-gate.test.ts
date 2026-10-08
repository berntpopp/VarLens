import { describe, expect, test } from 'vitest'
import { existsSync } from 'fs'
import { resolve } from 'path'

import { SAME_ORIGIN_HEADERS, startIsolatedWebSchema } from '../helpers/web-driver'

const WEB_BUILD_PATH = resolve(process.cwd(), 'out/web/server.cjs')
const isWebBuilt = existsSync(WEB_BUILD_PATH)
const HAS_PG = typeof process.env.VARLENS_PG_URL === 'string' && process.env.VARLENS_PG_URL !== ''

const USERNAME = 'admin'
const PASSWORD = 'auth-gate-password-2026'

interface InjectResult {
  statusCode: number
  body: string
  headers: Record<string, string | string[] | undefined>
  json: () => unknown
}

function setCookieValues(res: InjectResult): string[] {
  const setCookie = res.headers['set-cookie']
  if (setCookie === undefined) return []
  return Array.isArray(setCookie) ? setCookie.map(String) : [String(setCookie)]
}

describe.skipIf(!isWebBuilt || !HAS_PG)('web auth gate', () => {
  test('protected API requests return JSON 401 instead of redirecting', async () => {
    const isolated = await startIsolatedWebSchema('auth_gate_unauthenticated')
    try {
      const { buildApp } = await import('../../../src/web/server')
      const app = await buildApp()
      try {
        const res = (await app.inject({
          method: 'POST',
          url: '/api/database/capabilities',
          payload: { args: [] },
          headers: SAME_ORIGIN_HEADERS
        })) as unknown as InjectResult

        expect(res.statusCode, res.body).toBe(401)
        expect(res.headers.location).toBeUndefined()
        expect(String(res.headers['content-type'] ?? '')).toContain('application/json')
        expect(res.json()).toMatchObject({
          code: 'UNAUTHENTICATED',
          message: 'authentication required'
        })
      } finally {
        await app.close()
      }
    } finally {
      await isolated.close()
    }
  })

  test('a percent-encoded /api prefix is gated like the plain one (#506)', async () => {
    const isolated = await startIsolatedWebSchema('auth_gate_encoded_prefix')
    try {
      const { buildApp } = await import('../../../src/web/server')
      const app = await buildApp()
      try {
        const res = (await app.inject({
          method: 'POST',
          url: '/%61pi/cases/deleteAll',
          payload: { args: [] },
          headers: SAME_ORIGIN_HEADERS
        })) as unknown as InjectResult

        expect(res.statusCode, res.body).toBe(401)
        expect(res.json()).toMatchObject({ code: 'UNAUTHENTICATED' })
      } finally {
        await app.close()
      }
    } finally {
      await isolated.close()
    }
  })

  test('missing-Origin unsafe API requests return JSON 403 before auth dispatch', async () => {
    const isolated = await startIsolatedWebSchema('auth_gate_missing_origin')
    try {
      const { buildApp } = await import('../../../src/web/server')
      const app = await buildApp()
      try {
        const res = (await app.inject({
          method: 'POST',
          url: '/api/database/capabilities',
          payload: { args: [] }
        })) as unknown as InjectResult

        expect(res.statusCode, res.body).toBe(403)
        expect(res.headers.location).toBeUndefined()
        expect(String(res.headers['content-type'] ?? '')).toContain('application/json')
        expect(res.json()).toMatchObject({
          code: 'FORBIDDEN_ORIGIN',
          message: 'request origin is not allowed'
        })
      } finally {
        await app.close()
      }
    } finally {
      await isolated.close()
    }
  })

  test('cross-origin unsafe API requests return JSON 403 before auth dispatch', async () => {
    const isolated = await startIsolatedWebSchema('auth_gate_origin')
    try {
      const { buildApp } = await import('../../../src/web/server')
      const app = await buildApp()
      try {
        const res = (await app.inject({
          method: 'POST',
          url: '/api/database/capabilities',
          payload: { args: [] },
          headers: {
            host: 'varlens.example',
            origin: 'https://evil.example',
            'x-forwarded-proto': 'https'
          }
        })) as unknown as InjectResult

        expect(res.statusCode, res.body).toBe(403)
        expect(res.headers.location).toBeUndefined()
        expect(String(res.headers['content-type'] ?? '')).toContain('application/json')
        expect(res.json()).toMatchObject({
          code: 'FORBIDDEN_ORIGIN',
          message: 'request origin is not allowed'
        })
      } finally {
        await app.close()
      }
    } finally {
      await isolated.close()
    }
  })

  test('public auth login API is rate-limited by client address', async () => {
    const isolated = await startIsolatedWebSchema('auth_gate_login_rate_limit')
    const previousLimit = process.env.VARLENS_AUTH_LOGIN_RATE_LIMIT_MAX
    process.env.VARLENS_AUTH_LOGIN_RATE_LIMIT_MAX = '2'
    try {
      const { defaultPasswordProvider } =
        await import('../../../src/main/auth/providers/argon2-provider')
      const passwordHash = await defaultPasswordProvider.hashPassword(PASSWORD)
      const { buildApp } = await import('../../../src/web/server')
      const app = await buildApp({
        admin: { username: USERNAME, passwordHash, displayName: 'Rate Limit Admin' }
      })
      try {
        const attempt = async (): Promise<InjectResult> =>
          (await app.inject({
            method: 'POST',
            url: '/api/auth/login',
            payload: { args: [USERNAME, 'wrong-password'] },
            headers: SAME_ORIGIN_HEADERS
          })) as unknown as InjectResult

        expect((await attempt()).statusCode).toBe(200)
        expect((await attempt()).statusCode).toBe(200)

        const limited = await attempt()
        expect(limited.statusCode, limited.body).toBe(429)
        expect(limited.json()).toMatchObject({
          code: 'RATE_LIMITED',
          message: 'login rate limit exceeded'
        })
      } finally {
        await app.close()
      }
    } finally {
      if (previousLimit === undefined) delete process.env.VARLENS_AUTH_LOGIN_RATE_LIMIT_MAX
      else process.env.VARLENS_AUTH_LOGIN_RATE_LIMIT_MAX = previousLimit
      await isolated.close()
    }
  })

  test('production login sets a host-only secure strict session cookie', async () => {
    const isolated = await startIsolatedWebSchema('auth_gate_cookie')
    process.env.NODE_ENV = 'production'
    try {
      const { defaultPasswordProvider } =
        await import('../../../src/main/auth/providers/argon2-provider')
      const passwordHash = await defaultPasswordProvider.hashPassword(PASSWORD)
      const { buildApp } = await import('../../../src/web/server')
      const app = await buildApp({
        admin: { username: USERNAME, passwordHash, displayName: 'Cookie Test Admin' }
      })
      try {
        const res = (await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { args: [USERNAME, PASSWORD] },
          headers: SAME_ORIGIN_HEADERS
        })) as unknown as InjectResult

        expect(res.statusCode, res.body).toBe(200)
        const cookies = setCookieValues(res)
        expect(cookies).toHaveLength(1)
        const sessionCookie = cookies[0]
        expect(sessionCookie).toContain('__Host-varlens.sid=')
        expect(sessionCookie).toContain('Path=/')
        expect(sessionCookie).toContain('HttpOnly')
        expect(sessionCookie).toContain('Secure')
        expect(sessionCookie).toContain('SameSite=Strict')
        expect(sessionCookie).toContain('Max-Age=14400')
        expect(sessionCookie).not.toMatch(/;\s*Domain=/i)
      } finally {
        await app.close()
      }
    } finally {
      await isolated.close()
    }
  })
})
