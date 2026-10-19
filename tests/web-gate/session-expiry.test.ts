/**
 * #507: the cookie's server-side validity must end before a logout revocation
 * entry (6 h, session-revocation.ts) is forgotten. `maxAge` only binds the browser.
 */
import { afterEach, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fastify, { type FastifyInstance } from 'fastify'

import { registerSessions } from '../../src/web/server/auth'
import { SessionRevocations } from '../../src/web/server/session-revocation'
import { registerWebRateLimit } from '../../src/web/server/rate-limit'

const HOUR_MS = 60 * 60 * 1000
let app: FastifyInstance | undefined

afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  await app?.close()
})

test('a captured session cookie stops working after 4 h', async () => {
  vi.stubEnv('VARLENS_SESSION_SECRET_HEX', 'ab'.repeat(32))
  vi.useFakeTimers({ toFake: ['Date'] })
  app = fastify()
  await registerWebRateLimit(app)
  await registerSessions(app, {
    authService: {
      getSessionUser: async () => ({
        id: 1,
        username: 'admin',
        role: 'admin',
        is_active: 1,
        must_change_password: 0,
        password_changed_at: null
      })
    } as never
  })
  app.post('/test-login', async (request) => {
    request.session.user = { id: 1, username: 'admin', role: 'admin', passwordChangedAt: null }
    return {}
  })
  app.post('/api/:domain/:method', async () => ({}))

  const login = await app.inject({ method: 'POST', url: '/test-login' })
  const request = {
    method: 'POST',
    url: '/api/cases/list',
    headers: {
      'sec-fetch-site': 'same-origin',
      cookie: String(login.headers['set-cookie']).split(';', 1)[0]
    }
  } as const

  vi.advanceTimersByTime(4 * HOUR_MS - 60_000)
  expect((await app.inject(request)).statusCode).toBe(200)
  vi.advanceTimersByTime(2 * 60_000)
  expect((await app.inject(request)).statusCode).toBe(401)
})

test('rejects untrusted X-Forwarded-Proto header in CSRF check', async () => {
  vi.stubEnv('VARLENS_SESSION_SECRET_HEX', 'ab'.repeat(32))
  app = fastify({ trustProxy: false })
  await registerWebRateLimit(app)
  await registerSessions(app, {
    authService: {
      getSessionUser: async () => ({
        id: 1,
        username: 'admin',
        role: 'admin',
        is_active: 1,
        must_change_password: 0,
        password_changed_at: null
      })
    } as never
  })
  app.post('/test-login', async (request) => {
    request.session.user = { id: 1, username: 'admin', role: 'admin', passwordChangedAt: null }
    return {}
  })
  app.post('/api/:domain/:method', async () => ({}))

  const login = await app.inject({ method: 'POST', url: '/test-login' })
  const cookie = String(login.headers['set-cookie']).split(';', 1)[0]

  // Plain HTTP request spoofing X-Forwarded-Proto: https with HTTPS Origin
  const res = await app.inject({
    method: 'POST',
    url: '/api/cases/list',
    headers: {
      host: 'varlens.example',
      origin: 'https://varlens.example',
      'x-forwarded-proto': 'https',
      cookie
    }
  })
  // Fastify request.protocol is 'http' because trustProxy is false, so https origin is rejected as FORBIDDEN_ORIGIN (403)
  expect(res.statusCode).toBe(403)
})

test('revoked session cookie remains rejected after server restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'varlens-revocations-restart-'))
  const revocationsPath = join(dir, 'revocations.json')
  vi.stubEnv('VARLENS_SESSION_SECRET_HEX', 'cd'.repeat(32))
  vi.stubEnv('VARLENS_REVOKED_SESSIONS_PATH', revocationsPath)

  try {
    const authService = {
      getSessionUser: async () => ({
        id: 1,
        username: 'admin',
        role: 'admin',
        is_active: 1,
        must_change_password: 0,
        password_changed_at: null
      })
    } as never

    // Instance 1
    const r1 = new SessionRevocations(60_000, 10, Date.now, revocationsPath)
    app = fastify()
    await registerWebRateLimit(app)
    await registerSessions(app, { authService, revocations: r1 })
    app.post('/test-login', async (request) => {
      request.session.user = { id: 1, username: 'admin', role: 'admin', passwordChangedAt: null }
      request.session.sid = 'sid-restart-1'
      return {}
    })
    app.post('/api/:domain/:method', async () => ({}))

    const login = await app.inject({ method: 'POST', url: '/test-login' })
    const cookie = String(login.headers['set-cookie']).split(';', 1)[0]
    const request = {
      method: 'POST',
      url: '/api/cases/list',
      headers: {
        'sec-fetch-site': 'same-origin',
        cookie
      }
    } as const

    expect((await app.inject(request)).statusCode).toBe(200)

    // User logs out, revoking sid
    r1.revoke('sid-restart-1')
    expect((await app.inject(request)).statusCode).toBe(401)

    // Simulate server restart: close app1, boot fresh app2 with same secret and storage path
    await app.close()
    const r2 = new SessionRevocations(60_000, 10, Date.now, revocationsPath)
    app = fastify()
    await registerWebRateLimit(app)
    await registerSessions(app, { authService, revocations: r2 })
    app.post('/api/:domain/:method', async () => ({}))

    // Previous session cookie remains rejected after restart
    const resAfterRestart = await app.inject(request)
    expect(resAfterRestart.statusCode).toBe(401)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
