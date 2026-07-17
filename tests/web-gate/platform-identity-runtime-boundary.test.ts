import { describe, expect, test } from 'vitest'
import fastify from 'fastify'

import { PlatformIdentityService } from '../../src/web/server/platform-identity'
import { registerPlatformIdentityRoutes } from '../../src/web/server/platform-identity-routes'

describe('platform identity runtime boundary', () => {
  test('does not expose an infrastructure or user-provisioning HTTP endpoint', async () => {
    const app = fastify()
    const identity = new PlatformIdentityService({
      mode: 'platform',
      issuerUrl: 'https://identity.example.test/realms/varlens-platform',
      clientId: 'varlens-dev',
      audience: 'varlens-platform:app:varlens:dev',
      callbackPath: '/auth/platform/callback',
      requiredAcr: 'urn:varlens-platform:acr:password-plus-totp',
      requiredAmr: ['pwd', 'otp'],
      entitlementsUrl: 'http://ops.internal/api/identity/entitlements/varlens/dev',
      verifyAccessToken: false
    })
    registerPlatformIdentityRoutes(app, {
      identity,
      authService: {} as never,
      appPathPrefix: ''
    })

    const response = await app.inject({
      method: 'POST',
      url: '/platform/provisioning/users',
      payload: { subject: 'oidc-subject-1' }
    })

    expect(response.statusCode).toBe(404)
    await app.close()
  })
})
