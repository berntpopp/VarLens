/**
 * The identity provider's metadata for the desktop sign-in: OpenID Connect
 * discovery and the signing keys, fetched fresh for every sign-in through the
 * desktop's fetch (system proxy, no cookies).
 */
import type { Jwk } from '../../shared/auth/platform-jwt'

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export interface ProviderMetadata {
  authorizationEndpoint: string
  tokenEndpoint: string
  jwks: Jwk[]
}

const TIMEOUT_MS = 15_000

/** HTTPS, or plain HTTP when the issuer itself is a loopback HTTP URL. */
function endpoint(value: unknown, name: string, issuer: URL): string {
  if (typeof value !== 'string') throw new Error(`discovery has no ${name}`)
  const url = new URL(value)
  const loopbackIssuer = issuer.protocol === 'http:'
  if (url.protocol !== 'https:' && !(loopbackIssuer && url.origin === issuer.origin)) {
    throw new Error(`${name} must use https`)
  }
  if (url.username !== '' || url.password !== '' || url.hash !== '') {
    throw new Error(`${name} must not carry a user or fragment`)
  }
  return url.toString()
}

async function getJson(fetch: Fetch, url: string): Promise<Record<string, unknown>> {
  // No redirects: every endpoint stays the one discovery named.
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`${new URL(url).pathname} answered ${response.status}`)
  const body = (await response.json()) as unknown
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error(`${new URL(url).pathname} did not answer with a JSON object`)
  }
  return body as Record<string, unknown>
}

export async function loadProviderMetadata(
  fetch: Fetch,
  issuer: string
): Promise<ProviderMetadata> {
  const issuerUrl = new URL(issuer)
  const discovery = await getJson(
    fetch,
    `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`
  )
  if (discovery.issuer !== issuer) throw new Error('discovery names another issuer')
  const authorizationEndpoint = endpoint(
    discovery.authorization_endpoint,
    'authorization_endpoint',
    issuerUrl
  )
  const tokenEndpoint = endpoint(discovery.token_endpoint, 'token_endpoint', issuerUrl)
  const jwksUri = endpoint(discovery.jwks_uri, 'jwks_uri', issuerUrl)
  const keySet = await getJson(fetch, jwksUri)
  if (!Array.isArray(keySet.keys)) throw new Error('the key set has no keys')
  return { authorizationEndpoint, tokenEndpoint, jwks: keySet.keys as Jwk[] }
}

/** Exchange the authorization code; a public client sends no secret. */
export async function exchangeCode(
  fetch: Fetch,
  tokenEndpoint: string,
  params: { code: string; redirectUri: string; clientId: string; codeVerifier: string }
): Promise<{ idToken: string; accessToken: string }> {
  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: params.clientId,
      code_verifier: params.codeVerifier
    }).toString(),
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`the token endpoint answered ${response.status}`)
  const body = (await response.json()) as Record<string, unknown>
  if (typeof body.id_token !== 'string' || typeof body.access_token !== 'string') {
    throw new Error('the token endpoint returned no ID and access token')
  }
  // Nothing else is kept: no refresh token, and the tokens only until checked.
  return { idToken: body.id_token, accessToken: body.access_token }
}
