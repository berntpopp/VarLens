/**
 * #506: the gates must decide on the path the router matched. Fastify's router
 * percent-decodes before matching, so `/%61pi/...` reaches `/api/:domain/:method`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'

import { registerSessions } from '../../src/web/server/auth'
import { registerPageGate } from '../../src/web/server/page-gate'
import { registerWebRateLimit } from '../../src/web/server/rate-limit'
import { requestPath } from '../../src/web/server/request-path'
import { SessionRevocations } from '../../src/web/server/session-revocation'

const SAME_ORIGIN = { 'sec-fetch-site': 'same-origin' }
const USER = { id: 1, username: 'admin', role: 'admin', passwordChangedAt: null }

let app: FastifyInstance | undefined
const handler = vi.fn(async () => ({ reached: true }))

async function buildGatedApp(revocations = new SessionRevocations()): Promise<FastifyInstance> {
  const instance = fastify()
  await registerWebRateLimit(instance)
  await registerSessions(instance, {
    authService: {
      getSessionUser: async () => ({
        id: 1,
        username: 'admin',
        role: 'admin',
        is_active: 1,
        must_change_password: 0,
        password_changed_at: null
      })
    } as never,
    revocations
  })
  registerPageGate(instance, { appPathPrefix: '' })
  instance.post('/test-login', async (request) => {
    request.session.user = USER
    request.session.sid = 'sid-1'
    return {}
  })
  instance.post('/api/:domain/:method', handler)
  app = instance
  return instance
}

async function sessionCookie(instance: FastifyInstance): Promise<string> {
  const res = await instance.inject({ method: 'POST', url: '/test-login' })
  return String(res.headers['set-cookie']).split(';', 1)[0]
}

beforeEach(() => {
  vi.stubEnv('VARLENS_SESSION_SECRET_HEX', 'ab'.repeat(32))
  vi.stubEnv('VARLENS_AUTH_LOGIN_RATE_LIMIT_MAX', '2')
  handler.mockClear()
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await app?.close()
  app = undefined
})

describe('API gates on a percent-encoded /api prefix (#506)', () => {
  test('no session → 401', async () => {
    const instance = await buildGatedApp()
    for (const url of ['/%61pi/cases/deleteAll', '/%61%70%69/cases/deleteAll']) {
      const res = await instance.inject({ method: 'POST', url, headers: SAME_ORIGIN })
      expect(res.statusCode, url).toBe(401)
    }
    expect(handler).not.toHaveBeenCalled()
  })

  test('revoked sid → 401', async () => {
    const revocations = new SessionRevocations()
    const instance = await buildGatedApp(revocations)
    const cookie = await sessionCookie(instance)
    const request = {
      method: 'POST',
      url: '/%61pi/cases/deleteAll',
      headers: { ...SAME_ORIGIN, cookie }
    } as const

    expect((await instance.inject(request)).statusCode).toBe(200)
    revocations.revoke('sid-1')
    expect((await instance.inject(request)).statusCode).toBe(401)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  test('cross-origin → 403', async () => {
    const instance = await buildGatedApp()
    const res = await instance.inject({
      method: 'POST',
      url: '/%61pi/cases/deleteAll',
      headers: { 'sec-fetch-site': 'cross-site', cookie: await sessionCookie(instance) }
    })
    expect(res.statusCode).toBe(403)
    expect(handler).not.toHaveBeenCalled()
  })

  test('the login rate limit applies', async () => {
    const instance = await buildGatedApp()
    const codes: number[] = []
    for (const url of ['/%61pi/auth/login', '/api/auth/%6cogin', '/api/auth/login#x']) {
      codes.push((await instance.inject({ method: 'POST', url, headers: SAME_ORIGIN })).statusCode)
    }
    expect(codes).toEqual([200, 200, 429])
  })

  test('double-encoded and wrong-case prefixes never reach the API route', async () => {
    const instance = await buildGatedApp()
    for (const url of [
      '/%2561pi/cases/deleteAll',
      '/%41PI/cases/deleteAll',
      '/API/cases/deleteAll'
    ]) {
      const res = await instance.inject({ method: 'POST', url, headers: SAME_ORIGIN })
      expect(res.statusCode, url).toBe(404)
    }
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('requestPath', () => {
  const pathOf = (url: string, routeUrl?: string): string =>
    requestPath({ url, routeOptions: { url: routeUrl } } as unknown as FastifyRequest)

  test('normalises like the router: one decode, query/fragment dropped, absolute-form stripped', () => {
    expect(pathOf('/%61pi/cases/list?x=1')).toBe('/api/cases/list')
    expect(pathOf('/api/auth/login#frag')).toBe('/api/auth/login')
    expect(pathOf('http://evil.example/api/cases/deleteAll')).toBe('/api/cases/deleteAll')
    expect(pathOf('/%2561pi/x')).toBe('/%61pi/x')
    expect(pathOf('/cases/My%20Case')).toBe('/cases/My Case')
  })

  test('rejects malformed encoding with a 400', () => {
    expect(() => pathOf('/%E0%A4%A/x')).toThrow(expect.objectContaining({ statusCode: 400 }))
  })

  test('refuses a path that disagrees with a matched /api route', () => {
    expect(() => pathOf('/not-api', '/api/:domain/:method')).toThrow(
      expect.objectContaining({ statusCode: 400 })
    )
  })
})
