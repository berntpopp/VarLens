/**
 * #507: behind a reverse proxy `request.ip` is the proxy, so the login rate
 * limit must be able to key on the forwarded client address.
 */
import { afterEach, describe, expect, test } from 'vitest'
import fastify, { type FastifyInstance } from 'fastify'

import { resolveTrustProxy } from '../../src/web/server/instance-settings'
import { registerAuthLoginRateLimit, registerWebRateLimit } from '../../src/web/server/rate-limit'

let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

async function loginStatuses(env: NodeJS.ProcessEnv, clients: string[]): Promise<number[]> {
  app = fastify({ trustProxy: resolveTrustProxy(env) })
  await registerWebRateLimit(app)
  registerAuthLoginRateLimit(app, { VARLENS_AUTH_LOGIN_RATE_LIMIT_MAX: '1' })
  app.post('/api/auth/login', async () => ({}))
  const statuses: number[] = []
  for (const client of clients) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-forwarded-for': client }
    })
    statuses.push(res.statusCode)
  }
  return statuses
}

describe('VARLENS_WEB_TRUST_PROXY', () => {
  test('is off by default: forwarded headers are ignored', async () => {
    expect(resolveTrustProxy({})).toBe(false)
    expect(await loginStatuses({}, ['203.0.113.1', '203.0.113.2'])).toEqual([200, 429])
  })

  test('a hop count or proxy CIDR keys the login limit on the forwarded client', async () => {
    expect(resolveTrustProxy({ VARLENS_WEB_TRUST_PROXY: '1' })).toBe(1)
    expect(resolveTrustProxy({ VARLENS_WEB_TRUST_PROXY: ' 10.0.0.0/8, 127.0.0.1 ' })).toBe(
      '10.0.0.0/8,127.0.0.1'
    )
    expect(
      await loginStatuses({ VARLENS_WEB_TRUST_PROXY: '127.0.0.1' }, [
        '203.0.113.1',
        '203.0.113.2',
        '203.0.113.1'
      ])
    ).toEqual([200, 200, 429])
  })

  test('refuses trust-everything and malformed values', () => {
    for (const raw of [
      'true',
      '0',
      '-1',
      '1.5',
      '0.0.0.0/0',
      '::/0',
      'proxy.internal',
      '10.0.0.0/99'
    ]) {
      expect(() => resolveTrustProxy({ VARLENS_WEB_TRUST_PROXY: raw }), raw).toThrow(
        /VARLENS_WEB_TRUST_PROXY/
      )
    }
  })
})
