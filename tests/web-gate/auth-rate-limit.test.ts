/**
 * #563: changePassword runs a 64 MiB Argon2 verify per call, so it is rate
 * limited per signed-in user, before the handler (and its verify) runs.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import fastify, { type FastifyInstance } from 'fastify'

import { registerAuthLoginRateLimit, registerWebRateLimit } from '../../src/web/server/rate-limit'

const LIMIT = 10 // VARLENS_AUTH_LOGIN_RATE_LIMIT_MAX default

let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

async function buildApp(verify: () => void): Promise<FastifyInstance> {
  app = fastify()
  await registerWebRateLimit(app)
  // Stands in for the session gate, which runs before the rate-limit hook.
  app.addHook('preHandler', async (request) => {
    const id = Number(request.headers['x-user-id'])
    Object.assign(request, { session: { user: { id } } })
  })
  registerAuthLoginRateLimit(app, {})
  app.post('/api/auth/changePassword', async () => {
    verify()
    return { success: false }
  })
  return app
}

function changePassword(server: FastifyInstance, userId: number): Promise<number> {
  return server
    .inject({
      method: 'POST',
      url: '/api/auth/changePassword',
      headers: { 'x-user-id': String(userId) }
    })
    .then((res) => res.statusCode)
}

describe('changePassword rate limit', () => {
  test(`the ${LIMIT + 1}th call in a minute is 429 without running verify`, async () => {
    const verify = vi.fn()
    const server = await buildApp(verify)

    for (let i = 0; i < LIMIT; i++) expect(await changePassword(server, 1)).toBe(200)
    expect(await changePassword(server, 1)).toBe(429)
    expect(verify).toHaveBeenCalledTimes(LIMIT)

    // Keyed by user: another signed-in user from the same address is unaffected.
    expect(await changePassword(server, 2)).toBe(200)
  })
})
