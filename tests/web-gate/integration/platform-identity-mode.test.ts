import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, test } from 'vitest'
import type { FastifyInstance } from 'fastify'

import { SAME_ORIGIN_HEADERS, startIsolatedWebSchema } from '../helpers/web-driver'

const isWebBuilt = existsSync(resolve(process.cwd(), 'out/web/server.cjs'))
const hasPostgres =
  typeof process.env.VARLENS_PG_URL === 'string' && process.env.VARLENS_PG_URL !== ''

const PLATFORM_ENV = {
  APP_PATH_PREFIX: '/',
  VARLENS_AUTH_MODE: 'platform',
  VARLENS_PLATFORM_ISSUER_URL: 'https://identity.example.test/realms/varlens',
  VARLENS_PLATFORM_CLIENT_ID: 'varlens-test',
  VARLENS_PLATFORM_AUDIENCE: 'varlens-test',
  VARLENS_PLATFORM_REQUIRED_ACR: 'urn:example:acr:password-plus-totp',
  VARLENS_PLATFORM_REQUIRED_AMR: 'pwd,otp',
  VARLENS_PLATFORM_ENTITLEMENTS_URL: 'https://platform.example.test/entitlements'
} as const

describe.skipIf(!isWebBuilt || !hasPostgres)('platform identity mode integration', () => {
  test('redirects web sign-in to OIDC and disables the local login endpoint', async () => {
    const isolated = await startIsolatedWebSchema('platform_identity_mode')
    const previous = Object.fromEntries(
      Object.keys(PLATFORM_ENV).map((name) => [name, process.env[name]])
    )
    Object.assign(process.env, PLATFORM_ENV)

    let app: FastifyInstance | undefined
    try {
      const { buildApp } = await import('../../../src/web/server')
      app = await buildApp()

      const login = await app.inject({ method: 'GET', url: '/login?next=/cases' })
      expect(login.statusCode).toBe(302)
      expect(login.headers.location).toBe('/auth/platform/start?next=%2Fcases')

      const localLogin = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: SAME_ORIGIN_HEADERS,
        payload: { args: ['local-user', 'local-password'] }
      })
      expect(localLogin.statusCode).toBe(403)
      expect(localLogin.json()).toMatchObject({
        details: { error: 'platform-auth-required' }
      })
    } finally {
      await app?.close()
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
      await isolated.close()
    }
  })
})
