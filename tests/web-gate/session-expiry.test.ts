/**
 * #507: the cookie's server-side validity must end before a logout revocation
 * entry (6 h, session-revocation.ts) is forgotten. `maxAge` only binds the browser.
 */
import { afterEach, expect, test, vi } from 'vitest'
import fastify, { type FastifyInstance } from 'fastify'

import { registerSessions } from '../../src/web/server/auth'
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
