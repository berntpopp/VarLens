/**
 * The desktop platform sign-in (#295): an RFC 8252 native-app sign-in
 * through the system browser.
 *
 * 1. Fetch the provider's discovery document and signing keys.
 * 2. Listen on a loopback port and open the authorization request (code flow,
 *    PKCE S256, state, nonce, a fresh login) in the system browser.
 * 3. Exchange the code, then check both tokens with platform-jwt: signature,
 *    issuer, audience and client; on the ID token the nonce, acr, amr and a
 *    fresh auth_time; on the access token the access claim and the same subject.
 * 4. Open the session on the provider. The tokens are dropped after the
 *    check: the desktop calls nothing with them.
 *
 * Nothing about the person reaches the log; outcomes say what to do next.
 */
import { randomBytes } from 'crypto'
import type { DesktopSignInResult } from '../../shared/auth/desktop-auth-status'
import {
  PlatformMfaClaimError,
  assertPlatformMfaClaims,
  buildPkceChallenge,
  claimIncludes,
  requireStringClaim,
  verifyPlatformJwt
} from '../../shared/auth/platform-jwt'
import type { DesktopAuthConfig } from './desktop-auth-config'
import { exchangeCode, loadProviderMetadata, type Fetch } from './oidc-provider'
import { openLoopbackListener, type LoopbackListener } from './loopback-callback'

export interface SignInDependencies {
  config: DesktopAuthConfig
  fetch: Fetch
  /** Opens the authorization request in the system browser. */
  openBrowser(url: string): Promise<void>
  /** Called with the verified subject; opens the session. */
  onSignedIn(subject: string): Promise<void>
  log(level: 'info' | 'warn', message: string): void
  timeoutMs?: number
  now?: () => number
}

const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000

function random(): string {
  return randomBytes(32).toString('base64url')
}

function authorizationUrl(
  endpoint: string,
  config: DesktopAuthConfig,
  params: { redirectUri: string; state: string; nonce: string; verifier: string }
): string {
  // Keep a query the endpoint already carries (RFC 6749 section 3.1).
  const url = new URL(endpoint)
  const query = {
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: params.redirectUri,
    scope: 'openid',
    state: params.state,
    nonce: params.nonce,
    code_challenge: buildPkceChallenge(params.verifier),
    code_challenge_method: 'S256',
    acr_values: config.requiredAcr,
    prompt: 'login',
    max_age: '600'
  }
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value)
  return url.toString()
}

/** An OAuth error code is safe to log; anything else is not repeated. */
function providerError(value: string | undefined): string {
  return value !== undefined && /^[a-z_]{1,64}$/.test(value) ? value : 'an error'
}

/** For the log: what went wrong, never a token or claim value. */
function logSafe(error: unknown): string {
  return error instanceof SyntaxError ? 'a token that is not valid JSON' : message(error)
}

/** One sign-in at a time; `cancel()` ends the one in progress. */
export class PlatformSignIn {
  private running = false
  private cancelled = false
  private listener: LoopbackListener | undefined

  constructor(private readonly deps: SignInDependencies) {}

  get inProgress(): boolean {
    return this.running
  }

  cancel(): void {
    if (!this.running) return
    this.cancelled = true
    this.listener?.close()
  }

  async run(): Promise<DesktopSignInResult> {
    if (this.running) {
      return {
        outcome: 'failed',
        message: 'A sign-in is already waiting for the browser. Cancel it to start again.'
      }
    }
    this.running = true
    this.cancelled = false
    try {
      return await this.signIn()
    } finally {
      this.listener?.close()
      this.listener = undefined
      this.running = false
    }
  }

  private async signIn(): Promise<DesktopSignInResult> {
    const { config, fetch } = this.deps
    let metadata
    try {
      metadata = await loadProviderMetadata(fetch, config.issuer)
    } catch (error) {
      this.deps.log('warn', `Desktop sign-in: identity provider unavailable: ${message(error)}`)
      return { outcome: 'failed', message: unreachableMessage(error) }
    }
    if (this.cancelled) return { outcome: 'cancelled' }
    const state = random()
    const nonce = random()
    const verifier = random()
    try {
      this.listener = await openLoopbackListener(state, this.deps.timeoutMs ?? SIGN_IN_TIMEOUT_MS)
    } catch (error) {
      this.deps.log('warn', `Desktop sign-in: no loopback port: ${message(error)}`)
      return { outcome: 'failed', message: 'The sign-in could not start. Try again.' }
    }
    const listener = this.listener
    if (this.cancelled) return { outcome: 'cancelled' }
    const url = authorizationUrl(metadata.authorizationEndpoint, config, {
      redirectUri: listener.redirectUri,
      state,
      nonce,
      verifier
    })
    try {
      await this.deps.openBrowser(url)
    } catch (error) {
      this.deps.log('warn', `Desktop sign-in: the browser did not open: ${message(error)}`)
      return { outcome: 'failed', message: 'The browser could not be opened. Try again.' }
    }
    let callback
    try {
      callback = await listener.result
    } catch {
      if (this.cancelled) return { outcome: 'cancelled' }
      return { outcome: 'failed', message: 'The sign-in timed out. Start it again.' }
    }
    if (callback.code === undefined) {
      this.deps.log(
        'warn',
        `Desktop sign-in: the provider answered ${providerError(callback.error)}`
      )
      return { outcome: 'failed', message: 'The sign-in was not completed. Start it again.' }
    }
    try {
      const tokens = await exchangeCode(fetch, metadata.tokenEndpoint, {
        code: callback.code,
        redirectUri: listener.redirectUri,
        clientId: config.clientId,
        codeVerifier: verifier
      })
      return await this.verify(tokens, nonce, metadata.jwks)
    } catch (error) {
      this.deps.log('warn', `Desktop sign-in failed: ${logSafe(error)}`)
      return { outcome: 'failed', message: 'The sign-in could not be checked. Start it again.' }
    }
  }

  private async verify(
    tokens: { idToken: string; accessToken: string },
    nonce: string,
    jwks: Parameters<typeof verifyPlatformJwt>[0]['jwks']
  ): Promise<DesktopSignInResult> {
    const { config } = this.deps
    const nowSeconds = Math.floor((this.deps.now?.() ?? Date.now()) / 1000)
    const id = verifyPlatformJwt({
      token: tokens.idToken,
      issuer: config.issuer,
      audience: config.clientId,
      authorizedParty: config.clientId,
      jwks,
      nowSeconds
    })
    try {
      assertPlatformMfaClaims({
        payload: id.payload,
        requiredAcr: config.requiredAcr,
        requiredAmr: config.requiredAmr,
        expectedNonce: nonce,
        nowSeconds
      })
    } catch (error) {
      // The first sign-in sets the authenticator up without using it.
      if (error instanceof PlatformMfaClaimError && error.kind === 'amr') {
        const missing = error.missingAmr ?? ''
        this.deps.log(
          'info',
          `Desktop sign-in: the ID token lacks amr "${missing}"; asking for another sign-in`
        )
        return { outcome: 'enrolled' }
      }
      throw error
    }
    const access = verifyPlatformJwt({
      token: tokens.accessToken,
      issuer: config.issuer,
      audience: config.audience,
      authorizedParty: config.clientId,
      jwks,
      nowSeconds
    })
    const subject = requireStringClaim(id.payload, 'sub')
    if (requireStringClaim(access.payload, 'sub') !== subject) {
      throw new Error('the ID and access token name different subjects')
    }
    if (access.payload.azp !== config.clientId) {
      throw new Error('the access token was issued to another client')
    }
    if (!claimIncludes(access.payload[config.access.claim], config.access.value)) {
      this.deps.log('info', 'Desktop sign-in refused: the account has no desktop access')
      return { outcome: 'no-access' }
    }
    if (this.cancelled) return { outcome: 'cancelled' }
    try {
      await this.deps.onSignedIn(subject)
    } catch (error) {
      this.deps.log('warn', `Desktop sign-in: the session did not open: ${message(error)}`)
      return {
        outcome: 'failed',
        message:
          "VarLens could not close the last session's data yet. Wait a moment and sign in again; if this repeats, restart VarLens."
      }
    }
    this.deps.log('info', 'Desktop sign-in succeeded')
    return { outcome: 'signed-in' }
  }
}

/**
 * A TLS failure looks like an outage to the user unless it is named:
 * Chromium reports an untrusted, expired or mismatched certificate or a
 * broken TLS setup as net::ERR_CERT*, ERR_SSL_* or ERR_BAD_SSL_*, and only
 * an administrator can fix it.
 */
function unreachableMessage(error: unknown): string {
  return /ERR_(CERT|SSL_|BAD_SSL_)/.test(message(error))
    ? 'A secure connection to the sign-in service could not be made, for example because its certificate is not trusted on this computer. Ask your administrator.'
    : 'The sign-in service cannot be reached. Try again later.'
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
