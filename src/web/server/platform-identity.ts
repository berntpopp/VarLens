import { createHash, randomBytes } from 'node:crypto'

import type { FastifyRequest } from 'fastify'

import type { UserRole } from '../../shared/auth/auth-constants'
import type { User } from '../../shared/auth/types'
import type { PostgresWebAuthService } from '../auth/PostgresWebAuthService'
import type { PlatformIdentityConfig } from './platform-identity-config'
import {
  assertPlatformMfaClaims,
  requireStringClaim,
  verifyPlatformJwt,
  type Jwk,
  type VerifiedJwt
} from './platform-jwt'

export {
  assertPlatformMfaClaims,
  PlatformMfaClaimError,
  verifyPlatformJwt,
  type Jwk,
  type VerifiedJwt
} from './platform-jwt'
export {
  registerPlatformIdentityRoutes,
  type PlatformIdentityAuditInput
} from './platform-identity-routes'

const JWKS_CACHE_TTL_MS = 5 * 60 * 1000
const ENTITLEMENT_CACHE_TTL_MS = 30 * 1000
const ENTITLEMENT_CACHE_MAX_ENTRIES = 500
const OUTBOUND_FETCH_TIMEOUT_MS = 10_000

interface OidcDiscovery {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
}

interface TokenResponse {
  id_token: string
  access_token: string
  token_type?: string
}

interface EntitlementResponse {
  active?: boolean
  allowed?: boolean
  role?: string
  status?: string
  resourceStatus?: string
  reason?: string
}

export interface PlatformSessionUser {
  id: number
  username: string
  role: UserRole
  passwordChangedAt: string | null
}

function encodeBase64Url(buffer: Buffer): string {
  return buffer.toString('base64url')
}

function randomUrlSafeString(bytes = 32): string {
  return encodeBase64Url(randomBytes(bytes))
}

function buildPkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), OUTBOUND_FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

function isUserRole(value: string): value is UserRole {
  return value === 'admin' || value === 'user'
}

function assertObjectResponse(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} response must be a JSON object`)
  }
  return value as Record<string, unknown>
}

function requestOrigin(request: FastifyRequest): string {
  const forwardedProto = request.headers['x-forwarded-proto']
  const proto =
    typeof forwardedProto === 'string' && forwardedProto !== '' ? forwardedProto : request.protocol
  const forwardedHost = request.headers['x-forwarded-host']
  const host =
    typeof forwardedHost === 'string' && forwardedHost !== '' ? forwardedHost : request.headers.host
  if (typeof host !== 'string' || host.trim() === '') {
    throw new Error('Host header is required for OIDC redirect URI construction')
  }
  return `${proto}://${host}`
}

function callbackRedirectUri(
  request: FastifyRequest,
  appPathPrefix: string,
  callbackPath: string
): string {
  return `${requestOrigin(request)}${appPathPrefix}${callbackPath}`
}

export class PlatformIdentityService {
  private discoveryCache: Promise<OidcDiscovery> | null = null
  private jwksCache: { expiresAt: number; keys: Jwk[] } | null = null
  private entitlementCache = new Map<string, { expiresAt: number; role: UserRole }>()

  constructor(readonly config: PlatformIdentityConfig) {}

  buildStartLocation(appPathPrefix: string, next: string): string {
    const query = next !== '' ? `?next=${encodeURIComponent(next)}` : ''
    return `${appPathPrefix}/auth/platform/start${query}`
  }

  async resolveSessionUser(
    authService: PostgresWebAuthService,
    subject: string
  ): Promise<PlatformSessionUser> {
    const entitlement = await this.requireActiveEntitlement(subject)
    const liveUser = await authService.getUser(subject)
    if (liveUser === undefined || liveUser.is_active !== 1) {
      throw new Error('platform user is not provisioned or active in VarLens')
    }
    if (this.config.requireHostedResource) {
      this.assertHostedResourceActive(liveUser)
    }
    return {
      id: liveUser.id,
      username: subject,
      role: entitlement.role,
      passwordChangedAt: liveUser.password_changed_at
    }
  }

  async createAuthorizationUrl(params: {
    request: FastifyRequest
    appPathPrefix: string
    next: string
    forceFreshLogin?: boolean
  }): Promise<{ authorizationUrl: string; state: string; nonce: string; codeVerifier: string }> {
    const discovery = await this.discovery()
    const state = randomUrlSafeString()
    const nonce = randomUrlSafeString()
    const codeVerifier = randomUrlSafeString()
    const url = new URL(discovery.authorization_endpoint)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', this.config.clientId)
    url.searchParams.set(
      'redirect_uri',
      callbackRedirectUri(params.request, params.appPathPrefix, this.config.callbackPath)
    )
    url.searchParams.set('scope', 'openid profile email')
    url.searchParams.set('state', state)
    url.searchParams.set('nonce', nonce)
    url.searchParams.set('acr_values', this.config.requiredAcr)
    if (params.forceFreshLogin !== false) {
      url.searchParams.set('prompt', 'login')
      url.searchParams.set('max_age', '0')
    }
    url.searchParams.set('code_challenge_method', 'S256')
    url.searchParams.set('code_challenge', buildPkceChallenge(codeVerifier))
    return { authorizationUrl: url.toString(), state, nonce, codeVerifier }
  }

  async completeCallback(params: {
    request: FastifyRequest
    appPathPrefix: string
    code: string
    expectedNonce: string
    codeVerifier: string
  }): Promise<{ subject: string }> {
    const discovery = await this.discovery()
    const tokenResponse = await this.exchangeCode({
      discovery,
      request: params.request,
      appPathPrefix: params.appPathPrefix,
      code: params.code,
      codeVerifier: params.codeVerifier
    })
    const idToken = await this.verifyJwtWithJwks({
      token: tokenResponse.id_token,
      issuer: this.config.issuerUrl,
      audience: this.config.clientId,
      discovery
    })
    assertPlatformMfaClaims({
      payload: idToken.payload,
      requiredAcr: this.config.requiredAcr,
      requiredAmr: this.config.requiredAmr,
      expectedNonce: params.expectedNonce
    })
    // The id_token carries identity + MFA claims and is always verified. The
    // access_token is only JWT-verified when explicitly enabled: many IdPs
    // issue opaque (non-JWT) access tokens, which would otherwise fail the
    // 3-segment JWT check and break an otherwise valid login.
    if (this.config.verifyAccessToken === true) {
      await this.verifyJwtWithJwks({
        token: tokenResponse.access_token,
        issuer: this.config.issuerUrl,
        audience: this.config.audience,
        discovery
      })
    }
    return { subject: requireStringClaim(idToken.payload, 'sub') }
  }

  private async requireActiveEntitlement(subject: string): Promise<{ role: UserRole }> {
    const cached = this.entitlementCache.get(subject)
    if (cached !== undefined && cached.expiresAt > Date.now()) {
      return { role: cached.role }
    }
    const url = `${this.config.entitlementsUrl}/${encodeURIComponent(subject)}`
    const headers: Record<string, string> = {
      accept: 'application/json'
    }
    if (this.config.entitlementsToken !== undefined) {
      headers.authorization = `Bearer ${this.config.entitlementsToken}`
    }
    let response: Response
    try {
      response = await fetchWithTimeout(url, { headers })
    } catch (error) {
      throw new Error('platform entitlement check failed', { cause: error })
    }
    if (!response.ok) {
      throw new Error(`platform entitlement check returned HTTP ${response.status}`)
    }
    const body = assertObjectResponse((await response.json()) as unknown, 'entitlement')
    const wrapped = body.entitlement
    const entitlement = (
      typeof wrapped === 'object' && wrapped !== null && !Array.isArray(wrapped) ? wrapped : body
    ) as EntitlementResponse
    if (entitlement.active !== true && entitlement.allowed !== true) {
      throw new Error(`platform entitlement denied: ${entitlement.reason ?? 'not-allowed'}`)
    }
    if (entitlement.status !== 'active' || entitlement.resourceStatus !== 'active') {
      throw new Error('platform entitlement or resource is not active')
    }
    if (typeof entitlement.role !== 'string' || !isUserRole(entitlement.role)) {
      throw new Error('platform entitlement role is not valid for VarLens')
    }
    const result = { role: entitlement.role }
    if (this.entitlementCache.size >= ENTITLEMENT_CACHE_MAX_ENTRIES) {
      const firstKey = this.entitlementCache.keys().next().value
      if (typeof firstKey === 'string') {
        this.entitlementCache.delete(firstKey)
      }
    }
    this.entitlementCache.set(subject, {
      ...result,
      expiresAt: Date.now() + ENTITLEMENT_CACHE_TTL_MS
    })
    return result
  }

  private assertHostedResourceActive(user: User): void {
    if (user.private_db_status !== 'active') {
      throw new Error('hosted VarLens private database is not active for platform user')
    }
    if (typeof user.private_db_secret_ref !== 'string' || user.private_db_secret_ref === '') {
      throw new Error('hosted VarLens private database secret is missing for platform user')
    }
  }

  private async exchangeCode(params: {
    discovery: OidcDiscovery
    request: FastifyRequest
    appPathPrefix: string
    code: string
    codeVerifier: string
  }): Promise<TokenResponse> {
    const body = new URLSearchParams()
    body.set('grant_type', 'authorization_code')
    body.set('client_id', this.config.clientId)
    body.set('code', params.code)
    body.set('code_verifier', params.codeVerifier)
    body.set(
      'redirect_uri',
      callbackRedirectUri(params.request, params.appPathPrefix, this.config.callbackPath)
    )

    const response = await fetchWithTimeout(params.discovery.token_endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded'
      },
      body
    })
    if (!response.ok) {
      throw new Error(`OIDC token endpoint returned HTTP ${response.status}`)
    }
    const json = assertObjectResponse((await response.json()) as unknown, 'OIDC token')
    if (typeof json.id_token !== 'string' || typeof json.access_token !== 'string') {
      throw new Error('OIDC token response must include id_token and access_token')
    }
    return {
      id_token: json.id_token,
      access_token: json.access_token,
      token_type: typeof json.token_type === 'string' ? json.token_type : undefined
    }
  }

  private async discovery(): Promise<OidcDiscovery> {
    if (this.discoveryCache !== null) return await this.discoveryCache
    this.discoveryCache = this.fetchDiscovery().catch((error: unknown) => {
      this.discoveryCache = null
      throw error
    })
    return await this.discoveryCache
  }

  private async fetchDiscovery(): Promise<OidcDiscovery> {
    const response = await fetchWithTimeout(
      `${this.config.issuerUrl}/.well-known/openid-configuration`,
      {
        headers: { accept: 'application/json' }
      }
    )
    if (!response.ok) {
      throw new Error(`OIDC discovery returned HTTP ${response.status}`)
    }
    const json = assertObjectResponse((await response.json()) as unknown, 'OIDC discovery')
    if (json.issuer !== this.config.issuerUrl) {
      throw new Error('OIDC discovery issuer does not match configured issuer')
    }
    for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
      if (typeof json[field] !== 'string' || json[field] === '') {
        throw new Error(`OIDC discovery ${field} is required`)
      }
    }
    return {
      issuer: json.issuer,
      authorization_endpoint: json.authorization_endpoint,
      token_endpoint: json.token_endpoint,
      jwks_uri: json.jwks_uri
    }
  }

  private async jwks(discovery: OidcDiscovery): Promise<Jwk[]> {
    const now = Date.now()
    if (this.jwksCache !== null && this.jwksCache.expiresAt > now) return this.jwksCache.keys
    const response = await fetchWithTimeout(discovery.jwks_uri, {
      headers: { accept: 'application/json' }
    })
    if (!response.ok) {
      throw new Error(`JWKS endpoint returned HTTP ${response.status}`)
    }
    const json = assertObjectResponse((await response.json()) as unknown, 'JWKS')
    if (!Array.isArray(json.keys)) {
      throw new Error('JWKS keys array is required')
    }
    const keys = json.keys.filter((key): key is Jwk => typeof key === 'object' && key !== null)
    this.jwksCache = { keys, expiresAt: now + JWKS_CACHE_TTL_MS }
    return keys
  }

  private async verifyJwtWithJwks(params: {
    token: string
    issuer: string
    audience: string
    discovery: OidcDiscovery
  }): Promise<VerifiedJwt> {
    const firstKeys = await this.jwks(params.discovery)
    try {
      return verifyPlatformJwt({ ...params, jwks: firstKeys })
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith('JWKS key not found')) {
        throw error
      }
      this.jwksCache = null
      const refreshedKeys = await this.jwks(params.discovery)
      return verifyPlatformJwt({ ...params, jwks: refreshedKeys })
    }
  }
}
