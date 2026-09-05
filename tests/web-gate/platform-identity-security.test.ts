import { createSign, generateKeyPairSync } from 'node:crypto'
import { afterEach, describe, expect, test, vi } from 'vitest'
import fastify from 'fastify'
import type { InjectResult } from 'light-my-request'

import {
  PlatformIdentityRevokedError,
  PlatformIdentityService,
  verifyPlatformJwt
} from '../../src/web/server/platform-identity'
import { registerPlatformIdentityRoutes } from '../../src/web/server/platform-identity-routes'
import { registerSessions } from '../../src/web/server/auth'
import { registerWebRateLimit } from '../../src/web/server/rate-limit'
import { sanitizeNextParam } from '../../src/web/server/login-route'
import { buildNextParam } from '../../src/web/server/page-gate'
import { PostgresPlatformUserStore } from '../../src/web/auth/PostgresPlatformUserStore'

const ISSUER = 'https://identity.example.test/realms/varlens-platform'
const CLIENT_ID = 'varlens-dev'
const AUDIENCE = 'varlens-platform:app:varlens:dev'
const REQUIRED_ACR = 'urn:varlens-platform:acr:password-plus-totp'
const REQUIRED_AMR = ['pwd', 'otp']

const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 })
const publicJwkSig = {
  ...keyPair.publicKey.export({ format: 'jwk' }),
  kid: 'active-key',
  alg: 'RS256',
  use: 'sig'
}
const publicJwkEnc = {
  ...keyPair.publicKey.export({ format: 'jwk' }),
  kid: 'enc-key',
  alg: 'RS256',
  use: 'enc'
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

function basePayload(audience: string | string[] = AUDIENCE): Record<string, unknown> {
  return {
    iss: ISSUER,
    sub: 'platform-subject-1',
    aud: audience,
    exp: 2_000_000_000,
    iat: 1_900_000_000,
    auth_time: 1_949_999_940,
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

describe('open redirect sanitization', () => {
  test('sanitizeNextParam rejects tab, control characters, backslashes, and schemes', () => {
    // When invalid, falls back to defaultTarget ('/')
    expect(sanitizeNextParam('/\\evil.com', '')).toBe('/')
    expect(sanitizeNextParam('/\\/evil.com', '')).toBe('/')
    expect(sanitizeNextParam('/\tevil.com', '')).toBe('/')
    expect(sanitizeNextParam('/\t/evil.com', '')).toBe('/')
    expect(sanitizeNextParam('/\nevil.com', '')).toBe('/')
    expect(sanitizeNextParam('/\revil.com', '')).toBe('/')
    expect(sanitizeNextParam('//evil.com', '')).toBe('/')
    expect(sanitizeNextParam('https://evil.com', '')).toBe('/')
    expect(sanitizeNextParam('javascript:alert(1)', '')).toBe('/')
    expect(sanitizeNextParam('data:text/html,evil', '')).toBe('/')
    expect(sanitizeNextParam('/' + 'a'.repeat(600), '')).toBe('/')
  })

  test('sanitizeNextParam accepts valid relative paths', () => {
    expect(sanitizeNextParam('/', '')).toBe('/')
    expect(sanitizeNextParam('/cases', '')).toBe('/cases')
    expect(sanitizeNextParam('/cases?page=1&filter=all', '')).toBe('/cases?page=1&filter=all')
    expect(sanitizeNextParam('/cases#overview', '')).toBe('/cases#overview')
    expect(sanitizeNextParam('/varlens/cases', '/varlens')).toBe('/varlens/cases')
    expect(sanitizeNextParam('/outside/cases', '/varlens')).toBe('/varlens/')
  })

  test('buildNextParam sanitizes unsafe targets', () => {
    expect(buildNextParam('/\t/evil.com')).toBe('')
    expect(buildNextParam('/\\evil.com')).toBe('')
    expect(buildNextParam('//evil.com')).toBe('')
    expect(buildNextParam('https://evil.com')).toBe('')
    expect(buildNextParam('/cases')).toBe('/cases')
    expect(buildNextParam('/cases?tab=1')).toBe('/cases?tab=1')
  })
})

describe('OIDC state prototype pollution and bounds', () => {
  test('rejects __proto__, constructor, and malformed state in callback', async () => {
    process.env.NODE_ENV = 'test'
    process.env.VARLENS_SESSION_SECRET_HEX = '11'.repeat(32)

    const app = fastify()
    const identity = {
      config: { callbackPath: '/auth/platform/callback' },
      buildStartLocation: () => '/auth/platform/start',
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

    const protoRes = await app.inject({
      method: 'GET',
      url: '/auth/platform/callback?state=__proto__&code=xyz'
    })
    expect(protoRes.statusCode).toBe(302)
    expect(protoRes.headers.location).toBe('/auth/platform/start')

    const ctorRes = await app.inject({
      method: 'GET',
      url: '/auth/platform/callback?state=constructor&code=xyz'
    })
    expect(ctorRes.statusCode).toBe(302)
    expect(ctorRes.headers.location).toBe('/auth/platform/start')

    const longState = 'a'.repeat(200)
    const longRes = await app.inject({
      method: 'GET',
      url: `/auth/platform/callback?state=${longState}&code=xyz`
    })
    expect(longRes.statusCode).toBe(302)

    expect(identity.completeCallback).not.toHaveBeenCalled()
    await app.close()
  })

  test('bounds maximum pending OIDC states to 2', async () => {
    process.env.NODE_ENV = 'test'
    process.env.VARLENS_SESSION_SECRET_HEX = '11'.repeat(32)

    const app = fastify()
    let counter = 0
    const identity = {
      config: { callbackPath: '/auth/platform/callback' },
      buildStartLocation: () => '/auth/platform/start',
      createAuthorizationUrl: vi.fn(async () => {
        counter++
        return {
          authorizationUrl: `https://identity.example.test/auth?state=state-${counter}`,
          state: `state-${counter}`,
          nonce: `nonce-${counter}`,
          codeVerifier: `verifier-${counter}`
        }
      }),
      completeCallback: vi.fn(async (params: { state: string }) => ({
        subject: `sub-${params.state}`
      })),
      resolveSessionUser: vi.fn(async () => ({
        id: 1,
        username: 'user-1',
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

    // Issue 3 starts in the same session
    const s1 = await app.inject({ method: 'GET', url: '/auth/platform/start' })
    const c1 = extractCookie(s1)
    const s2 = await app.inject({
      method: 'GET',
      url: '/auth/platform/start',
      headers: { cookie: c1 }
    })
    const c2 = extractCookie(s2)
    const s3 = await app.inject({
      method: 'GET',
      url: '/auth/platform/start',
      headers: { cookie: c2 }
    })
    const c3 = extractCookie(s3)

    // The first state (state-1) should have been evicted because MAX_PENDING_OIDC_STATES = 2
    const staleRes = await app.inject({
      method: 'GET',
      url: '/auth/platform/callback?state=state-1&code=c1',
      headers: { cookie: c3 }
    })
    expect(staleRes.statusCode).toBe(302)
    expect(staleRes.headers.location).toBe('/auth/platform/start')

    // The second and third states should still be valid
    const validRes2 = await app.inject({
      method: 'GET',
      url: '/auth/platform/callback?state=state-2&code=c2',
      headers: { cookie: c3 }
    })
    expect(validRes2.statusCode).toBe(302)
    expect(validRes2.headers.location).toBe('/')

    await app.close()
  })
})

describe('JWT key use and authorized party (azp) verification', () => {
  test('rejects JWKS key with use: enc', () => {
    const token = signJwt(basePayload(CLIENT_ID), { kid: 'enc-key' })
    expect(() =>
      verifyPlatformJwt({
        token,
        issuer: ISSUER,
        audience: CLIENT_ID,
        jwks: [publicJwkEnc],
        nowSeconds: 1_950_000_000
      })
    ).toThrow(/JWKS key not found/)
  })

  test('validates azp when present even on single audience', () => {
    const token = signJwt({ ...basePayload(CLIENT_ID), azp: 'attacker-client' })
    expect(() =>
      verifyPlatformJwt({
        token,
        issuer: ISSUER,
        audience: CLIENT_ID,
        jwks: [publicJwkSig],
        nowSeconds: 1_950_000_000
      })
    ).toThrow(/azp/)
  })

  test('validates azp against authorizedParty when audience differs from client ID', () => {
    const token = signJwt({
      ...basePayload('varlens-platform:app:varlens:dev'),
      azp: 'varlens-dev'
    })
    const verified = verifyPlatformJwt({
      token,
      issuer: ISSUER,
      audience: 'varlens-platform:app:varlens:dev',
      authorizedParty: 'varlens-dev',
      jwks: [publicJwkSig],
      nowSeconds: 1_950_000_000
    })
    expect(verified.payload.azp).toBe('varlens-dev')

    expect(() =>
      verifyPlatformJwt({
        token,
        issuer: ISSUER,
        audience: 'varlens-platform:app:varlens:dev',
        authorizedParty: 'attacker-client',
        jwks: [publicJwkSig],
        nowSeconds: 1_950_000_000
      })
    ).toThrow(/azp does not match expected client/)
  })

  test('rejects subject claim longer than 255 chars', () => {
    const token = signJwt({ ...basePayload(CLIENT_ID), sub: 'x'.repeat(256) })
    expect(() =>
      verifyPlatformJwt({
        token,
        issuer: ISSUER,
        audience: CLIENT_ID,
        jwks: [publicJwkSig],
        nowSeconds: 1_950_000_000
      })
    ).toThrow(/sub claim exceeds 255/)
  })
})

describe('entitlement deduplication and status handling', () => {
  test('deduplicates concurrent in-flight entitlement requests', async () => {
    let callCount = 0
    const fetchMock = vi.fn(async () => {
      callCount++
      // simulate network delay
      await new Promise((resolve) => setTimeout(resolve, 20))
      return new Response(
        JSON.stringify({
          entitlement: { active: true, role: 'user', status: 'active' }
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
      verifyAccessToken: false
    })

    const authService = {
      getPlatformUser: vi.fn(async () => ({
        id: 42,
        username: 'platform-subject-1',
        role: 'user',
        is_active: 1,
        password_changed_at: null
      }))
    } as never

    // Dispatch 5 concurrent resolveSessionUser calls
    const results = await Promise.all([
      service.resolveSessionUser(authService, 'platform-subject-1'),
      service.resolveSessionUser(authService, 'platform-subject-1'),
      service.resolveSessionUser(authService, 'platform-subject-1'),
      service.resolveSessionUser(authService, 'platform-subject-1'),
      service.resolveSessionUser(authService, 'platform-subject-1')
    ])

    expect(callCount).toBe(1)
    for (const r of results) {
      expect(r?.username).toBe('platform-subject-1')
    }
  })

  test('accepts active entitlement when status is omitted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              entitlement: { active: true, role: 'admin' }
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
      )
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
      verifyAccessToken: false
    })

    const authService = {
      getPlatformUser: vi.fn(async () => ({
        id: 1,
        username: 'sub-1',
        role: 'user',
        is_active: 1,
        password_changed_at: null
      }))
    } as never

    const user = await service.resolveSessionUser(authService, 'sub-1')
    expect(user?.role).toBe('admin')
  })

  test('aborts and cleans up when response body stalls', async () => {
    process.env.VARLENS_OUTBOUND_FETCH_TIMEOUT_MS = '50'
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
    const stalledStream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller
        controller.enqueue(new TextEncoder().encode('{"entitlement":'))
      }
    })

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      init?.signal?.addEventListener('abort', () => {
        streamController?.error(new DOMException('The operation was aborted', 'AbortError'))
      })
      return new Response(stalledStream, { status: 200 })
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
      verifyAccessToken: false
    })

    const authService = {
      getPlatformUser: vi.fn()
    } as never

    await expect(service.resolveSessionUser(authService, 'sub-stalled')).rejects.toThrow()
    delete process.env.VARLENS_OUTBOUND_FETCH_TIMEOUT_MS
  })
})

describe('session hook: revocation (401) vs transient failure (503)', () => {
  test('PlatformIdentityRevokedError returns 401 and clears session cookie', async () => {
    process.env.NODE_ENV = 'test'
    process.env.VARLENS_SESSION_SECRET_HEX = '11'.repeat(32)

    const app = fastify()
    const identity = {
      config: { callbackPath: '/auth/platform/callback' },
      resolveSessionUser: vi.fn().mockRejectedValue(new PlatformIdentityRevokedError('Revoked'))
    } as unknown as PlatformIdentityService

    await registerWebRateLimit(app)
    await registerSessions(app, {
      authService: { getUser: vi.fn() } as never,
      platformIdentity: identity
    })

    app.get('/api/test-session', async (request) => {
      return { user: request.session.user }
    })

    // Seed session with an active platform user
    app.get('/seed', async (request) => {
      request.session.user = { id: 1, username: 'sub-1', role: 'user' }
      request.session.authMode = 'platform'
      return { ok: true }
    })

    const seedRes = await app.inject({ method: 'GET', url: '/seed' })
    const cookie = extractCookie(seedRes)

    // Now call /api/test-session; resolveSessionUser throws PlatformIdentityRevokedError
    const apiRes = await app.inject({
      method: 'GET',
      url: '/api/test-session',
      headers: { cookie }
    })

    expect(apiRes.statusCode).toBe(401)
    const setCookie = apiRes.headers['set-cookie']
    // Cookie should be expired/cleared
    expect(String(setCookie)).toMatch(/Max-Age=0|Expires=/)
    await app.close()
  })

  test('transient network error returns 503 without clearing session', async () => {
    process.env.NODE_ENV = 'test'
    process.env.VARLENS_SESSION_SECRET_HEX = '11'.repeat(32)

    const app = fastify()
    const identity = {
      config: { callbackPath: '/auth/platform/callback' },
      resolveSessionUser: vi.fn().mockRejectedValue(new Error('Network outage'))
    } as unknown as PlatformIdentityService

    await registerWebRateLimit(app)
    await registerSessions(app, {
      authService: { getUser: vi.fn() } as never,
      platformIdentity: identity
    })

    app.get('/api/test-session', async (request) => {
      return { user: request.session.user }
    })

    app.get('/seed', async (request) => {
      request.session.user = { id: 1, username: 'sub-1', role: 'user' }
      request.session.authMode = 'platform'
      return { ok: true }
    })

    const seedRes = await app.inject({ method: 'GET', url: '/seed' })
    const cookie = extractCookie(seedRes)

    const apiRes = await app.inject({
      method: 'GET',
      url: '/api/test-session',
      headers: { cookie }
    })

    expect(apiRes.statusCode).toBe(503)
    const setCookie = apiRes.headers['set-cookie']
    // Cookie should NOT be deleted with Max-Age=0
    expect(String(setCookie || '')).not.toContain('Max-Age=0')
    await app.close()
  })

  test('clears user and authMode from session when starting platform login', async () => {
    process.env.NODE_ENV = 'test'
    process.env.VARLENS_SESSION_SECRET_HEX = '11'.repeat(32)

    const app = fastify()
    const identity = {
      config: { callbackPath: '/auth/platform/callback' },
      createAuthorizationUrl: vi.fn(async () => ({
        authorizationUrl: 'https://idp.test/auth',
        state: 'safe-state-1',
        nonce: 'safe-nonce-1',
        codeVerifier: 'safe-verifier-1'
      })),
      buildStartLocation: vi.fn(() => '/auth/platform/start')
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

    app.get('/seed', async (request) => {
      request.session.user = {
        id: 1,
        username: 'previous-user',
        role: 'user',
        passwordChangedAt: null
      }
      request.session.authMode = 'platform'
      return { ok: true }
    })

    app.get('/session-check', async (request) => {
      return {
        user: request.session.user,
        authMode: request.session.authMode,
        hasOidc: request.session.platformOidc !== undefined
      }
    })

    const seedRes = await app.inject({ method: 'GET', url: '/seed' })
    const initialCookie = extractCookie(seedRes)

    // Hit /auth/platform/start with the authenticated cookie
    const startRes = await app.inject({
      method: 'GET',
      url: '/auth/platform/start',
      headers: { cookie: initialCookie }
    })
    expect(startRes.statusCode).toBe(302)
    const newCookie = extractCookie(startRes)

    // Verify the session cookie has user/authMode cleared and platformOidc set
    const checkRes = await app.inject({
      method: 'GET',
      url: '/session-check',
      headers: { cookie: newCookie }
    })
    expect(checkRes.statusCode).toBe(200)
    const data = checkRes.json()
    expect(data.user).toBeUndefined()
    expect(data.authMode).toBeUndefined()
    expect(data.hasOidc).toBe(true)

    await app.close()
  })
})

describe('PostgresPlatformUserStore validation', () => {
  test('rejects empty or whitespace subject and displayName', async () => {
    const store = new PostgresPlatformUserStore({} as never, 'public')

    await expect(
      store.upsert({
        subject: '',
        displayName: 'Alice',
        role: 'user'
      })
    ).rejects.toThrow(/non-empty/)

    await expect(
      store.upsert({
        subject: '   ',
        displayName: 'Alice',
        role: 'user'
      })
    ).rejects.toThrow(/non-empty/)

    await expect(
      store.upsert({
        subject: 'sub-1',
        displayName: '',
        role: 'user'
      })
    ).rejects.toThrow(/non-empty/)

    await expect(
      store.upsert({
        subject: 'x'.repeat(256),
        displayName: 'Alice',
        role: 'user'
      })
    ).rejects.toThrow(/<= 255/)
  })
})

describe('platform authentication gate and rate limiting edge cases', () => {
  test('allows custom callbackPath starting with /api/ to bypass preHandler unauthenticated gate', async () => {
    process.env.NODE_ENV = 'test'
    process.env.VARLENS_SESSION_SECRET_HEX = '11'.repeat(32)
    const app = fastify()
    const identity = {
      config: { callbackPath: '/api/auth/platform/callback' },
      buildStartLocation: () => '/auth/platform/start',
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

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/platform/callback'
    })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/auth/platform/start')
    await app.close()
  })

  test('rate limits platform start and callback endpoints', async () => {
    process.env.NODE_ENV = 'test'
    process.env.VARLENS_SESSION_SECRET_HEX = '11'.repeat(32)
    const originalMax = process.env.VARLENS_PLATFORM_AUTH_RATE_LIMIT_MAX
    process.env.VARLENS_PLATFORM_AUTH_RATE_LIMIT_MAX = '2'
    const app = fastify()
    const identity = {
      config: { callbackPath: '/auth/platform/callback' },
      buildStartLocation: () => '/auth/platform/start',
      completeCallback: vi.fn(),
      resolveSessionUser: vi.fn(),
      createAuthorizationUrl: vi.fn().mockResolvedValue({
        authorizationUrl: 'https://identity.example.test/auth',
        state: 'st-1',
        nonce: 'non-1',
        codeVerifier: 'cv-1'
      })
    } as unknown as PlatformIdentityService

    try {
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

      const res1 = await app.inject({ method: 'GET', url: '/auth/platform/start' })
      expect(res1.statusCode).toBe(302)

      const res2 = await app.inject({ method: 'GET', url: '/auth/platform/start' })
      expect(res2.statusCode).toBe(302)

      const res3 = await app.inject({ method: 'GET', url: '/auth/platform/start' })
      expect(res3.statusCode).toBe(429)
    } finally {
      await app.close()
      if (originalMax === undefined) delete process.env.VARLENS_PLATFORM_AUTH_RATE_LIMIT_MAX
      else process.env.VARLENS_PLATFORM_AUTH_RATE_LIMIT_MAX = originalMax
    }
  })
})
