import { describe, it, expect, vi } from 'vitest'
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'crypto'
import { PlatformSignIn, type SignInDependencies } from '../../../src/main/auth/platform-sign-in'
import type { DesktopAuthConfig } from '../../../src/main/auth/desktop-auth-config'

const ISSUER = 'https://idp.example.org/realms/varlens'
const CONFIG: DesktopAuthConfig = {
  issuer: ISSUER,
  clientId: 'varlens-desktop',
  audience: 'varlens-desktop',
  requiredAcr: 'urn:varlens:acr:password-plus-totp',
  requiredAmr: ['pwd', 'otp'],
  access: { claim: 'groups', value: '/varlens-desktop' },
  idleLockMinutes: 15,
  maxSessionMinutes: 480,
  requirePassphrase: false
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const JWK = {
  ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>),
  kid: 'k1',
  use: 'sig',
  alg: 'RS256'
}

const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey

interface Signing {
  key?: KeyObject
  header?: Record<string, unknown>
}

function jwt(payload: Record<string, unknown>, signing: Signing = {}): string {
  const key = signing.key ?? privateKey
  const header = Buffer.from(
    JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT', ...signing.header })
  ).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = sign('sha256', Buffer.from(`${header}.${body}`), key).toString('base64url')
  return `${header}.${body}.${signature}`
}

interface Scenario {
  idClaims?: Record<string, unknown>
  accessClaims?: Record<string, unknown>
  idSigning?: Signing
  accessSigning?: Signing
  /** The browser cannot be opened. */
  browserFails?: boolean
  discovery?: Record<string, unknown>
  /** The discovery request fails with this network error. */
  discoveryError?: string
  callback?: (params: URLSearchParams) => string
  /** Do not answer: the user never finishes in the browser. */
  silent?: boolean
}

function setup(scenario: Scenario = {}) {
  const now = Math.floor(Date.now() / 1000)
  let authorization: URLSearchParams | undefined
  const tokenRequests: URLSearchParams[] = []
  const fetch = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    if (url === `${ISSUER}/.well-known/openid-configuration`) {
      if (scenario.discoveryError !== undefined) throw new Error(scenario.discoveryError)
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth`,
        token_endpoint: `${ISSUER}/protocol/openid-connect/token`,
        jwks_uri: `${ISSUER}/protocol/openid-connect/certs`,
        ...scenario.discovery
      })
    }
    if (url === `${ISSUER}/protocol/openid-connect/certs`) return Response.json({ keys: [JWK] })
    if (url === `${ISSUER}/protocol/openid-connect/token`) {
      const form = new URLSearchParams(String(init?.body))
      tokenRequests.push(form)
      const challenge = createHash('sha256')
        .update(form.get('code_verifier') ?? '')
        .digest('base64url')
      if (challenge !== authorization?.get('code_challenge') || form.get('code') !== 'the-code') {
        return Response.json({ error: 'invalid_grant' }, { status: 400 })
      }
      const common = {
        iss: ISSUER,
        sub: 'subject-1',
        azp: 'varlens-desktop',
        iat: now,
        exp: now + 300
      }
      return Response.json({
        id_token: jwt(
          {
            ...common,
            aud: 'varlens-desktop',
            nonce: authorization.get('nonce'),
            acr: CONFIG.requiredAcr,
            amr: ['pwd', 'otp'],
            auth_time: now,
            ...scenario.idClaims
          },
          scenario.idSigning
        ),
        access_token: jwt(
          {
            ...common,
            aud: ['varlens-desktop'],
            groups: ['/varlens-desktop'],
            ...scenario.accessClaims
          },
          scenario.accessSigning
        ),
        token_type: 'Bearer'
      })
    }
    return new Response('not found', { status: 404 })
  })
  const unlocked: string[] = []
  const logs: string[] = []
  const opened: string[] = []
  const deps: SignInDependencies = {
    config: CONFIG,
    fetch,
    openBrowser: async (url) => {
      opened.push(url)
      if (scenario.browserFails === true) throw new Error('no browser')
      const request = new URL(url)
      authorization = request.searchParams
      if (scenario.silent === true) return
      const redirect = new URL(authorization.get('redirect_uri') ?? '')
      const query =
        scenario.callback?.(authorization) ?? `code=the-code&state=${authorization.get('state')}`
      // The browser follows the provider's redirect to the loopback address.
      void globalThis.fetch(`${redirect.toString()}?${query}`)
    },
    onSignedIn: async (subject) => {
      unlocked.push(subject)
    },
    log: (_level, message) => logs.push(message),
    timeoutMs: 2_000
  }
  return {
    signIn: new PlatformSignIn(deps),
    unlocked,
    logs,
    opened,
    tokenRequests,
    request: () => authorization
  }
}

describe('desktop platform sign-in', () => {
  it('signs in with code flow, PKCE and a loopback redirect, and opens the session', async () => {
    const { signIn, unlocked, request, tokenRequests } = setup()
    await expect(signIn.run()).resolves.toEqual({ outcome: 'signed-in' })
    expect(unlocked).toEqual(['subject-1'])
    const params = request()!
    expect(params.get('response_type')).toBe('code')
    expect(params.get('code_challenge_method')).toBe('S256')
    expect(params.get('scope')).toBe('openid')
    expect(params.get('prompt')).toBe('login')
    expect(params.get('acr_values')).toBe(CONFIG.requiredAcr)
    expect(params.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    expect(tokenRequests[0].get('client_secret')).toBeNull()
    expect(signIn.inProgress).toBe(false)
  })

  it('asks for one more sign-in after the authenticator was set up', async () => {
    const { signIn, unlocked } = setup({ idClaims: { amr: ['pwd'] } })
    await expect(signIn.run()).resolves.toEqual({ outcome: 'enrolled' })
    expect(unlocked).toEqual([])
  })

  it('refuses an account without the access claim', async () => {
    const { signIn, unlocked } = setup({ accessClaims: { groups: ['/elsewhere'] } })
    await expect(signIn.run()).resolves.toEqual({ outcome: 'no-access' })
    expect(unlocked).toEqual([])
  })

  it.each([
    ['a foreign nonce', { idClaims: { nonce: 'other' } }],
    ['a wrong acr', { idClaims: { acr: 'urn:other' } }],
    ['an old authentication', { idClaims: { auth_time: Math.floor(Date.now() / 1000) - 3600 } }],
    ['an ID token for another client', { idClaims: { aud: 'other-client' } }],
    ['an access token for another audience', { accessClaims: { aud: ['other'] } }],
    ['tokens for two subjects', { accessClaims: { sub: 'subject-2' } }],
    ['another issuer in the token', { idClaims: { iss: 'https://evil.example.org' } }]
  ])('fails on %s', async (_label, scenario) => {
    const { signIn, unlocked } = setup(scenario)
    const result = await signIn.run()
    expect(result.outcome).toBe('failed')
    expect(unlocked).toEqual([])
  })

  it.each([
    ['an ID token signed with another key', { idSigning: { key: other } }],
    ['an access token signed with another key', { accessSigning: { key: other } }],
    ['an unknown key id', { idSigning: { header: { kid: 'k2' } } }],
    ['a symmetric algorithm', { idSigning: { header: { alg: 'HS256' } } }],
    ['no algorithm', { accessSigning: { header: { alg: 'none' } } }],
    ['an expired ID token', { idClaims: { exp: Math.floor(Date.now() / 1000) - 600 } }],
    ['an expired access token', { accessClaims: { exp: Math.floor(Date.now() / 1000) - 600 } }],
    ['no auth_time', { idClaims: { auth_time: undefined } }],
    ['an access token issued to another client', { accessClaims: { azp: 'other-client' } }],
    ['an access token without azp', { accessClaims: { azp: undefined } }]
  ])('fails on %s', async (_label, scenario) => {
    const { signIn, unlocked } = setup(scenario)
    await expect(signIn.run()).resolves.toMatchObject({ outcome: 'failed' })
    expect(unlocked).toEqual([])
  })

  it('keeps a query the authorization endpoint already carries', async () => {
    const { signIn, request } = setup({
      discovery: { authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth?tenant=t1` }
    })
    await signIn.run()
    expect(request()?.get('tenant')).toBe('t1')
    expect(request()?.get('code_challenge_method')).toBe('S256')
  })

  it('says so when the browser cannot be opened', async () => {
    const { signIn } = setup({ browserFails: true })
    await expect(signIn.run()).resolves.toEqual({
      outcome: 'failed',
      message: 'The browser could not be opened. Try again.'
    })
  })

  it('opens one browser for two sign-ins started together', async () => {
    const { signIn, opened } = setup()
    const [first, second] = await Promise.all([signIn.run(), signIn.run()])
    expect([first.outcome, second.outcome].sort()).toEqual(['failed', 'signed-in'])
    expect(opened).toHaveLength(1)
  })

  it('stops a sign-in cancelled before the browser opens', async () => {
    const { signIn, opened } = setup()
    const run = signIn.run()
    signIn.cancel()
    await expect(run).resolves.toEqual({ outcome: 'cancelled' })
    expect(opened).toEqual([])
  })

  it('logs why it asks for another sign-in, and no raw provider error', async () => {
    const enrolled = setup({ idClaims: { amr: ['pwd'] } })
    await enrolled.signIn.run()
    expect(enrolled.logs.join('\n')).toContain('lacks amr "otp"')
    const odd = setup({ callback: (p) => `error=%3Cscript%3E&state=${p.get('state')}` })
    await odd.signIn.run()
    expect(odd.logs.join('\n')).toContain('answered an error')
    expect(odd.logs.join('\n')).not.toContain('<script>')
  })

  it('fails when the discovery document names another issuer or plain HTTP endpoints', async () => {
    for (const discovery of [
      { issuer: 'https://evil.example.org' },
      { token_endpoint: 'http://idp.example.org/token' }
    ]) {
      const { signIn } = setup({ discovery })
      await expect(signIn.run()).resolves.toMatchObject({ outcome: 'failed' })
    }
  })

  it('names a TLS failure instead of reporting an outage', async () => {
    const tls =
      'A secure connection to the sign-in service could not be made, for example because its certificate is not trusted on this computer. Ask your administrator.'
    for (const error of ['net::ERR_CERT_AUTHORITY_INVALID', 'net::ERR_SSL_PROTOCOL_ERROR']) {
      const failing = setup({ discoveryError: error })
      await expect(failing.signIn.run()).resolves.toEqual({ outcome: 'failed', message: tls })
      expect(failing.opened).toEqual([])
    }
    const down = setup({ discoveryError: 'net::ERR_CONNECTION_REFUSED' })
    await expect(down.signIn.run()).resolves.toEqual({
      outcome: 'failed',
      message: 'The sign-in service cannot be reached. Try again later.'
    })
  })

  it('fails when the provider answers with an error', async () => {
    const { signIn } = setup({ callback: (p) => `error=access_denied&state=${p.get('state')}` })
    await expect(signIn.run()).resolves.toMatchObject({ outcome: 'failed' })
  })

  it('keeps waiting through a request with a foreign state', async () => {
    const { signIn, unlocked } = setup({
      callback: (p) => {
        const redirect = p.get('redirect_uri')
        void globalThis.fetch(`${redirect}?code=stolen&state=forged`)
        return `code=the-code&state=${p.get('state')}`
      }
    })
    await expect(signIn.run()).resolves.toEqual({ outcome: 'signed-in' })
    expect(unlocked).toEqual(['subject-1'])
  })

  it('can be cancelled while it waits for the browser, and times out', async () => {
    const waiting = setup({ silent: true })
    const run = waiting.signIn.run()
    await vi.waitFor(() => expect(waiting.opened).toHaveLength(1))
    waiting.signIn.cancel()
    await expect(run).resolves.toEqual({ outcome: 'cancelled' })

    const slow = setup({ silent: true })
    await expect(slow.signIn.run()).resolves.toMatchObject({ outcome: 'failed' })
  })

  it('runs one sign-in at a time', async () => {
    const { signIn } = setup({ silent: true })
    const first = signIn.run()
    await vi.waitFor(() => expect(signIn.inProgress).toBe(true))
    await expect(signIn.run()).resolves.toMatchObject({ outcome: 'failed' })
    signIn.cancel()
    await first
  })

  it('logs no token and no subject', async () => {
    const { signIn, logs } = setup({ accessClaims: { groups: [] } })
    await signIn.run()
    const success = setup()
    await success.signIn.run()
    for (const line of [...logs, ...success.logs]) {
      expect(line).not.toMatch(/subject-1|eyJ/)
    }
  })
})
