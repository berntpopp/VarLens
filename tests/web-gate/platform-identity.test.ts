import { createSign, generateKeyPairSync } from 'node:crypto'

import { afterEach, describe, expect, test, vi } from 'vitest'
import fastify from 'fastify'
import type { InjectResult } from 'light-my-request'

import {
  assertPlatformMfaClaims,
  PlatformMfaClaimError,
  PlatformIdentityService,
  registerPlatformIdentityRoutes,
  verifyPlatformJwt
} from '../../src/web/server/platform-identity'
import { registerSessions } from '../../src/web/server/auth'
import { registerWebRateLimit } from '../../src/web/server/rate-limit'

const ISSUER = 'https://identity.example.test/realms/lb-map'
const CLIENT_ID = 'varlens-dev'
const AUDIENCE = 'lb-map:app:varlens:dev'
const REQUIRED_ACR = 'urn:lb-map:acr:password-plus-totp'
const REQUIRED_AMR = ['pwd', 'otp']

const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 })
const publicJwk = {
  ...keyPair.publicKey.export({ format: 'jwk' }),
  kid: 'active-key',
  alg: 'RS256',
  use: 'sig'
}
const rotatedKeyPair = generateKeyPairSync('rsa', { modulusLength: 2048 })
const rotatedPublicJwk = {
  ...rotatedKeyPair.publicKey.export({ format: 'jwk' }),
  kid: 'rotated-key',
  alg: 'RS256',
  use: 'sig'
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.VARLENS_SESSION_SECRET_HEX
  delete process.env.NODE_ENV
})

function encodeJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function signJwt(payload: Record<string, unknown>, header: Record<string, unknown> = {}): string {
  const encodedHeader = encodeJson({ alg: 'RS256', kid: 'active-key', typ: 'JWT', ...header })
  const encodedPayload = encodeJson(payload)
  const signer = createSign('RSA-SHA256')
  signer.update(`${encodedHeader}.${encodedPayload}`)
  signer.end()
  const signature = signer.sign(keyPair.privateKey).toString('base64url')
  return `${encodedHeader}.${encodedPayload}.${signature}`
}

function signRotatedJwt(payload: Record<string, unknown>): string {
  const encodedHeader = encodeJson({ alg: 'RS256', kid: 'rotated-key', typ: 'JWT' })
  const encodedPayload = encodeJson(payload)
  const signer = createSign('RSA-SHA256')
  signer.update(`${encodedHeader}.${encodedPayload}`)
  signer.end()
  const signature = signer.sign(rotatedKeyPair.privateKey).toString('base64url')
  return `${encodedHeader}.${encodedPayload}.${signature}`
}

function basePayload(audience = AUDIENCE): Record<string, unknown> {
  return {
    iss: ISSUER,
    sub: 'platform-subject-1',
    aud: audience,
    exp: 2_000_000_000,
    iat: 1_900_000_000,
    nonce: 'nonce-1',
    acr: REQUIRED_ACR,
    amr: REQUIRED_AMR
  }
}

function extractCookie(res: InjectResult): string {
  const setCookie = res.headers['set-cookie']
  const values = Array.isArray(setCookie) ? setCookie : setCookie !== undefined ? [setCookie] : []
  return values.map((cookie) => String(cookie).split(';', 1)[0]).join('; ')
}

describe('platform identity JWT validation', () => {
  test('accepts an RS256 token with matching issuer, kid, audience and MFA claims', () => {
    const token = signJwt(basePayload(CLIENT_ID))
    const verified = verifyPlatformJwt({
      token,
      issuer: ISSUER,
      audience: CLIENT_ID,
      jwks: [publicJwk],
      nowSeconds: 1_950_000_000
    })

    expect(verified.payload.sub).toBe('platform-subject-1')
    assertPlatformMfaClaims({
      payload: verified.payload,
      requiredAcr: REQUIRED_ACR,
      requiredAmr: REQUIRED_AMR,
      expectedNonce: 'nonce-1'
    })
  })

  test('rejects wrong environment audience', () => {
    const token = signJwt(basePayload('lb-map:app:varlens:test'))

    expect(() =>
      verifyPlatformJwt({
        token,
        issuer: ISSUER,
        audience: AUDIENCE,
        jwks: [publicJwk],
        nowSeconds: 1_950_000_000
      })
    ).toThrow(/audience/)
  })

  test('rejects missing TOTP MFA assertion', () => {
    const token = signJwt({ ...basePayload(CLIENT_ID), amr: ['pwd'] })
    const verified = verifyPlatformJwt({
      token,
      issuer: ISSUER,
      audience: CLIENT_ID,
      jwks: [publicJwk],
      nowSeconds: 1_950_000_000
    })

    expect(() =>
      assertPlatformMfaClaims({
        payload: verified.payload,
        requiredAcr: REQUIRED_ACR,
        requiredAmr: REQUIRED_AMR,
        expectedNonce: 'nonce-1'
      })
    ).toThrow(/otp/)
  })

  test('rejects tokens without the active JWKS kid', () => {
    const token = signJwt(basePayload(CLIENT_ID), { kid: 'rotated-away' })

    expect(() =>
      verifyPlatformJwt({
        token,
        issuer: ISSUER,
        audience: CLIENT_ID,
        jwks: [publicJwk],
        nowSeconds: 1_950_000_000
      })
    ).toThrow(/kid/)
  })
})

describe('platform identity entitlement validation', () => {
  test('accepts the lb-map-operations wrapped entitlement decision contract', async () => {
    const fetchMock = vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      expect(url).toBe(
        'http://ops.internal/api/identity/entitlements/varlens/dev/platform-subject-1'
      )
      expect(init?.headers?.authorization).toBe('Bearer introspection-token')
      return new Response(
        JSON.stringify({
          entitlement: {
            active: true,
            subject: 'platform-subject-1',
            app: 'varlens',
            environment: 'dev',
            role: 'admin',
            status: 'active',
            resourceStatus: 'active'
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const service = new PlatformIdentityService({
      mode: 'platform',
      issuerUrl: ISSUER,
      clientId: CLIENT_ID,
      audience: AUDIENCE,
      callbackPath: '/auth/platform/callback',
      requiredAcr: REQUIRED_ACR,
      requiredAmr: REQUIRED_AMR,
      entitlementsUrl: 'http://ops.internal/api/identity/entitlements/varlens/dev',
      entitlementsToken: 'introspection-token',
      requireHostedResource: false
    })

    const result = await service.resolveSessionUser(
      {
        getUser: vi.fn(async () => ({
          id: 42,
          username: 'platform-subject-1',
          role: 'user',
          is_active: 1,
          password_changed_at: null
        }))
      } as never,
      'platform-subject-1'
    )

    expect(result).toEqual({
      id: 42,
      username: 'platform-subject-1',
      role: 'admin',
      passwordChangedAt: null
    })
  })

  test('caches active entitlement decisions for the short revalidation window', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          entitlement: {
            active: true,
            role: 'user',
            status: 'active',
            resourceStatus: 'active'
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const service = new PlatformIdentityService({
      mode: 'platform',
      issuerUrl: ISSUER,
      clientId: CLIENT_ID,
      audience: AUDIENCE,
      callbackPath: '/auth/platform/callback',
      requiredAcr: REQUIRED_ACR,
      requiredAmr: REQUIRED_AMR,
      entitlementsUrl: 'http://ops.internal/api/identity/entitlements/varlens/dev',
      requireHostedResource: false
    })
    const authService = {
      getUser: vi.fn(async () => ({
        id: 42,
        username: 'platform-subject-1',
        role: 'user',
        is_active: 1,
        password_changed_at: null
      }))
    } as never

    await service.resolveSessionUser(authService, 'platform-subject-1')
    await service.resolveSessionUser(authService, 'platform-subject-1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('platform identity OIDC start', () => {
  test('requests the configured ACR through acr_values', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            issuer: ISSUER,
            authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth`,
            token_endpoint: `${ISSUER}/protocol/openid-connect/token`,
            jwks_uri: `${ISSUER}/protocol/openid-connect/certs`
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      })
    )
    const service = new PlatformIdentityService({
      mode: 'platform',
      issuerUrl: ISSUER,
      clientId: CLIENT_ID,
      audience: AUDIENCE,
      callbackPath: '/auth/platform/callback',
      requiredAcr: REQUIRED_ACR,
      requiredAmr: REQUIRED_AMR,
      entitlementsUrl: 'http://ops.internal/api/identity/entitlements/varlens/dev',
      requireHostedResource: false
    })

    const result = await service.createAuthorizationUrl({
      request: {
        protocol: 'https',
        headers: { host: 'varlens-dev.example.test' }
      } as never,
      appPathPrefix: '',
      next: '/'
    })

    expect(new URL(result.authorizationUrl).searchParams.get('acr_values')).toBe(REQUIRED_ACR)
    expect(new URL(result.authorizationUrl).searchParams.get('prompt')).toBe('login')
    expect(new URL(result.authorizationUrl).searchParams.get('max_age')).toBe('0')
  })

  test('does not force a fresh Keycloak login for the internal MFA retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            issuer: ISSUER,
            authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth`,
            token_endpoint: `${ISSUER}/protocol/openid-connect/token`,
            jwks_uri: `${ISSUER}/protocol/openid-connect/certs`
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      })
    )
    const service = new PlatformIdentityService({
      mode: 'platform',
      issuerUrl: ISSUER,
      clientId: CLIENT_ID,
      audience: AUDIENCE,
      callbackPath: '/auth/platform/callback',
      requiredAcr: REQUIRED_ACR,
      requiredAmr: REQUIRED_AMR,
      entitlementsUrl: 'http://ops.internal/api/identity/entitlements/varlens/dev',
      requireHostedResource: false
    })

    const result = await service.createAuthorizationUrl({
      request: {
        protocol: 'https',
        headers: { host: 'varlens-dev.example.test' }
      } as never,
      appPathPrefix: '',
      next: '/',
      forceFreshLogin: false
    })
    const params = new URL(result.authorizationUrl).searchParams

    expect(params.get('acr_values')).toBe(REQUIRED_ACR)
    expect(params.get('prompt')).toBeNull()
    expect(params.get('max_age')).toBeNull()
  })

  test('does not cache a transient discovery failure forever', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary discovery outage'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            issuer: ISSUER,
            authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth`,
            token_endpoint: `${ISSUER}/protocol/openid-connect/token`,
            jwks_uri: `${ISSUER}/protocol/openid-connect/certs`
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    vi.stubGlobal('fetch', fetchMock)
    const service = new PlatformIdentityService({
      mode: 'platform',
      issuerUrl: ISSUER,
      clientId: CLIENT_ID,
      audience: AUDIENCE,
      callbackPath: '/auth/platform/callback',
      requiredAcr: REQUIRED_ACR,
      requiredAmr: REQUIRED_AMR,
      entitlementsUrl: 'http://ops.internal/api/identity/entitlements/varlens/dev',
      requireHostedResource: false
    })
    const request = {
      protocol: 'https',
      headers: { host: 'varlens-dev.example.test' }
    } as never

    await expect(
      service.createAuthorizationUrl({ request, appPathPrefix: '', next: '/' })
    ).rejects.toThrow(/temporary discovery outage/)
    const result = await service.createAuthorizationUrl({ request, appPathPrefix: '', next: '/' })

    expect(result.authorizationUrl.startsWith(ISSUER)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('refreshes JWKS once when the token kid is not in the warm cache', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000)
    const token = signRotatedJwt({
      ...basePayload(CLIENT_ID),
      exp: nowSeconds + 600,
      iat: nowSeconds - 60
    })
    const accessToken = signRotatedJwt({
      ...basePayload(AUDIENCE),
      nonce: undefined,
      acr: undefined,
      amr: undefined,
      exp: nowSeconds + 600,
      iat: nowSeconds - 60
    })
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/.well-known/openid-configuration')) {
        return new Response(
          JSON.stringify({
            issuer: ISSUER,
            authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth`,
            token_endpoint: `${ISSUER}/protocol/openid-connect/token`,
            jwks_uri: `${ISSUER}/protocol/openid-connect/certs`
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      if (url.endsWith('/token')) {
        return new Response(JSON.stringify({ id_token: token, access_token: accessToken }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      if (url.endsWith('/certs')) {
        const keys =
          fetchMock.mock.calls.filter(([calledUrl]) => String(calledUrl).endsWith('/certs'))
            .length === 1
            ? [publicJwk]
            : [rotatedPublicJwk]
        return new Response(JSON.stringify({ keys }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      throw new Error(`unexpected URL ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const service = new PlatformIdentityService({
      mode: 'platform',
      issuerUrl: ISSUER,
      clientId: CLIENT_ID,
      audience: AUDIENCE,
      callbackPath: '/auth/platform/callback',
      requiredAcr: REQUIRED_ACR,
      requiredAmr: REQUIRED_AMR,
      entitlementsUrl: 'http://ops.internal/api/identity/entitlements/varlens/dev',
      requireHostedResource: false
    })

    const result = await service.completeCallback({
      request: {
        protocol: 'https',
        headers: { host: 'varlens-dev.example.test' }
      } as never,
      appPathPrefix: '',
      code: 'code-1',
      expectedNonce: 'nonce-1',
      codeVerifier: 'verifier-1'
    })

    expect(result.subject).toBe('platform-subject-1')
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/certs'))).toHaveLength(2)
  })
})

describe('platform identity provisioning route', () => {
  test('creates a platform user only with the provisioning bearer token', async () => {
    const app = fastify()
    const upsertPlatformUser = vi.fn(async () => ({
      id: 3,
      username: 'keycloak-subject',
      role: 'user',
      private_db_status: 'active'
    }))
    const service = new PlatformIdentityService({
      mode: 'platform',
      issuerUrl: ISSUER,
      clientId: CLIENT_ID,
      audience: AUDIENCE,
      callbackPath: '/auth/platform/callback',
      requiredAcr: REQUIRED_ACR,
      requiredAmr: REQUIRED_AMR,
      entitlementsUrl: 'http://ops.internal/api/identity/entitlements/varlens/dev',
      provisioningToken: 'provision-token',
      requireHostedResource: false
    })
    registerPlatformIdentityRoutes(app, {
      identity: service,
      authService: { upsertPlatformUser } as never,
      appPathPrefix: ''
    })

    const denied = await app.inject({
      method: 'POST',
      url: '/platform/provisioning/users',
      payload: { subject: 'keycloak-subject', role: 'user' }
    })
    expect(denied.statusCode).toBe(403)

    const accepted = await app.inject({
      method: 'POST',
      url: '/platform/provisioning/users',
      headers: { authorization: 'Bearer provision-token' },
      payload: {
        subject: 'keycloak-subject',
        displayName: 'Keycloak User',
        role: 'user',
        privateDbSecretRef: 'keycloak-subject.pgurl',
        privateDbStatus: 'active'
      }
    })

    expect(accepted.statusCode).toBe(200)
    expect(upsertPlatformUser).toHaveBeenCalledWith({
      username: 'keycloak-subject',
      displayName: 'Keycloak User',
      role: 'user',
      privateDbSecretRef: 'keycloak-subject.pgurl',
      privateDbStatus: 'active'
    })
    await app.close()
  })
})

describe('platform identity callback session state', () => {
  test('keeps older pending authorization states when a second start happens before callback', async () => {
    process.env.NODE_ENV = 'test'
    process.env.VARLENS_SESSION_SECRET_HEX = '11'.repeat(32)

    const app = fastify()
    const completeCallback = vi.fn(async () => ({ subject: 'platform-subject-1' }))
    const resolveSessionUser = vi.fn(async () => ({
      id: 42,
      username: 'platform-subject-1',
      role: 'user' as const,
      passwordChangedAt: null
    }))
    const identity = {
      config: { callbackPath: '/auth/platform/callback' },
      createAuthorizationUrl: vi
        .fn()
        .mockResolvedValueOnce({
          authorizationUrl: 'https://identity.example.test/auth?state=state-1',
          state: 'state-1',
          nonce: 'nonce-1',
          codeVerifier: 'verifier-1'
        })
        .mockResolvedValueOnce({
          authorizationUrl: 'https://identity.example.test/auth?state=state-2',
          state: 'state-2',
          nonce: 'nonce-2',
          codeVerifier: 'verifier-2'
        }),
      completeCallback,
      resolveSessionUser
    } as unknown as PlatformIdentityService

    await registerWebRateLimit(app)
    await registerSessions(app, {
      authService: { getUser: vi.fn() } as never,
      platformIdentity: identity
    })
    registerPlatformIdentityRoutes(app, {
      identity,
      authService: {} as never,
      appPathPrefix: ''
    })

    const firstStart = await app.inject({ method: 'GET', url: '/auth/platform/start?next=%2F' })
    const firstCookie = extractCookie(firstStart)
    const secondStart = await app.inject({
      method: 'GET',
      url: '/auth/platform/start?next=%2F',
      headers: { cookie: firstCookie }
    })
    const secondCookie = extractCookie(secondStart)

    const firstCallback = await app.inject({
      method: 'GET',
      url: '/auth/platform/callback?state=state-1&code=code-1',
      headers: { cookie: secondCookie }
    })

    expect(firstCallback.statusCode).toBe(302)
    expect(firstCallback.headers.location).toBe('/')
    expect(completeCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'code-1',
        expectedNonce: 'nonce-1',
        codeVerifier: 'verifier-1'
      })
    )
    expect(resolveSessionUser).toHaveBeenCalledWith(expect.anything(), 'platform-subject-1')
    await app.close()
  })

  test('restarts login once when first TOTP enrollment callback lacks the OTP amr claim', async () => {
    process.env.NODE_ENV = 'test'
    process.env.VARLENS_SESSION_SECRET_HEX = '11'.repeat(32)

    const app = fastify()
    const completeCallback = vi.fn(async () => {
      throw new PlatformMfaClaimError('required MFA amr is missing: otp', 'amr', 'otp')
    })
    const identity = {
      config: { callbackPath: '/auth/platform/callback' },
      buildStartLocation: (appPathPrefix: string, next: string) =>
        `${appPathPrefix}/auth/platform/start?next=${encodeURIComponent(next)}`,
      createAuthorizationUrl: vi.fn().mockResolvedValue({
        authorizationUrl: 'https://identity.example.test/auth?state=state-1',
        state: 'state-1',
        nonce: 'nonce-1',
        codeVerifier: 'verifier-1'
      }),
      completeCallback,
      resolveSessionUser: vi.fn()
    } as unknown as PlatformIdentityService

    await registerWebRateLimit(app)
    await registerSessions(app, {
      authService: { getUser: vi.fn() } as never,
      platformIdentity: identity
    })
    registerPlatformIdentityRoutes(app, {
      identity,
      authService: {} as never,
      appPathPrefix: ''
    })

    const start = await app.inject({ method: 'GET', url: '/auth/platform/start?next=%2Fcases' })
    const cookie = extractCookie(start)
    const callback = await app.inject({
      method: 'GET',
      url: '/auth/platform/callback?state=state-1&code=code-1',
      headers: { cookie }
    })

    expect(callback.statusCode).toBe(302)
    expect(callback.headers.location).toBe('/auth/platform/start?next=%2Fcases&mfaRetry=1')
    await app.close()
  })

  test('denies the callback when the forced MFA retry still lacks the OTP amr claim', async () => {
    process.env.NODE_ENV = 'test'
    process.env.VARLENS_SESSION_SECRET_HEX = '11'.repeat(32)

    const app = fastify()
    const createAuthorizationUrl = vi.fn().mockResolvedValue({
      authorizationUrl: 'https://identity.example.test/auth?state=state-1',
      state: 'state-1',
      nonce: 'nonce-1',
      codeVerifier: 'verifier-1'
    })
    const identity = {
      config: { callbackPath: '/auth/platform/callback' },
      buildStartLocation: (appPathPrefix: string, next: string) =>
        `${appPathPrefix}/auth/platform/start?next=${encodeURIComponent(next)}`,
      createAuthorizationUrl,
      completeCallback: vi.fn(async () => {
        throw new PlatformMfaClaimError('required MFA amr is missing: otp', 'amr', 'otp')
      }),
      resolveSessionUser: vi.fn()
    } as unknown as PlatformIdentityService

    await registerWebRateLimit(app)
    await registerSessions(app, {
      authService: { getUser: vi.fn() } as never,
      platformIdentity: identity
    })
    registerPlatformIdentityRoutes(app, {
      identity,
      authService: {} as never,
      appPathPrefix: ''
    })

    const start = await app.inject({
      method: 'GET',
      url: '/auth/platform/start?next=%2Fcases&mfaRetry=1'
    })
    const cookie = extractCookie(start)
    const callback = await app.inject({
      method: 'GET',
      url: '/auth/platform/callback?state=state-1&code=code-1',
      headers: { cookie }
    })

    expect(createAuthorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({ forceFreshLogin: false })
    )
    expect(callback.statusCode).toBe(401)
    expect(callback.headers['content-type']).toContain('text/html')
    expect(callback.body).toContain('Anmeldung konnte nicht abgeschlossen werden')
    expect(callback.body).toContain('Erneut anmelden')
    await app.close()
  })

  test('restarts login cleanly when a stale callback has no pending state', async () => {
    process.env.NODE_ENV = 'test'
    process.env.VARLENS_SESSION_SECRET_HEX = '11'.repeat(32)

    const app = fastify()
    const identity = {
      config: { callbackPath: '/auth/platform/callback' },
      buildStartLocation: (appPathPrefix: string, next: string) =>
        next === ''
          ? `${appPathPrefix}/auth/platform/start`
          : `${appPathPrefix}/auth/platform/start?next=${encodeURIComponent(next)}`,
      createAuthorizationUrl: vi.fn(),
      completeCallback: vi.fn(),
      resolveSessionUser: vi.fn()
    } as unknown as PlatformIdentityService

    await registerWebRateLimit(app)
    await registerSessions(app, {
      authService: { getUser: vi.fn() } as never,
      platformIdentity: identity
    })
    registerPlatformIdentityRoutes(app, {
      identity,
      authService: {} as never,
      appPathPrefix: ''
    })

    const callback = await app.inject({
      method: 'GET',
      url: '/auth/platform/callback?state=stale-state&code=code-1'
    })

    expect(callback.statusCode).toBe(302)
    expect(callback.headers.location).toBe('/auth/platform/start')
    expect(callback.body).toBe('')
    await app.close()
  })

  test('returns home when an already logged-in user revisits an old callback URL', async () => {
    process.env.NODE_ENV = 'test'
    process.env.VARLENS_SESSION_SECRET_HEX = '11'.repeat(32)

    const app = fastify()
    const completeCallback = vi.fn(async () => ({ subject: 'platform-subject-1' }))
    const identity = {
      config: { callbackPath: '/auth/platform/callback' },
      buildStartLocation: (appPathPrefix: string, next: string) =>
        next === ''
          ? `${appPathPrefix}/auth/platform/start`
          : `${appPathPrefix}/auth/platform/start?next=${encodeURIComponent(next)}`,
      createAuthorizationUrl: vi.fn().mockResolvedValue({
        authorizationUrl: 'https://identity.example.test/auth?state=state-1',
        state: 'state-1',
        nonce: 'nonce-1',
        codeVerifier: 'verifier-1'
      }),
      completeCallback,
      resolveSessionUser: vi.fn(async () => ({
        id: 42,
        username: 'platform-subject-1',
        role: 'user' as const,
        passwordChangedAt: null
      }))
    } as unknown as PlatformIdentityService

    await registerWebRateLimit(app)
    await registerSessions(app, {
      authService: { getUser: vi.fn() } as never,
      platformIdentity: identity
    })
    registerPlatformIdentityRoutes(app, {
      identity,
      authService: {} as never,
      appPathPrefix: ''
    })

    const start = await app.inject({ method: 'GET', url: '/auth/platform/start?next=%2F' })
    const startCookie = extractCookie(start)
    const success = await app.inject({
      method: 'GET',
      url: '/auth/platform/callback?state=state-1&code=code-1',
      headers: { cookie: startCookie }
    })
    const authenticatedCookie = extractCookie(success)
    const staleCallback = await app.inject({
      method: 'GET',
      url: '/auth/platform/callback?state=state-1&code=code-1',
      headers: { cookie: authenticatedCookie }
    })

    expect(success.statusCode).toBe(302)
    expect(staleCallback.statusCode).toBe(302)
    expect(staleCallback.headers.location).toBe('/')
    expect(completeCallback).toHaveBeenCalledTimes(1)
    await app.close()
  })
})
