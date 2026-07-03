import { createPublicKey, createVerify } from 'node:crypto'

const JWT_CLOCK_SKEW_SECONDS = 60
const SUPPORTED_JWT_ALG = 'RS256'

export interface Jwk {
  kid?: string
  kty?: string
  alg?: string
  use?: string
  n?: string
  e?: string
  [key: string]: unknown
}

export interface VerifiedJwt {
  header: Record<string, unknown>
  payload: Record<string, unknown>
}

function decodeBase64UrlJson(value: string): Record<string, unknown> {
  const decoded = Buffer.from(value, 'base64url').toString('utf8')
  const parsed = JSON.parse(decoded) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('JWT segment must decode to a JSON object')
  }
  return parsed as Record<string, unknown>
}

function claimIncludes(value: unknown, expected: string): boolean {
  if (typeof value === 'string') return value === expected
  if (Array.isArray(value)) return value.includes(expected)
  return false
}

function claimStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((part): part is string => typeof part === 'string')
  if (typeof value === 'string') return [value]
  return []
}

export function requireStringClaim(payload: Record<string, unknown>, name: string): string {
  const value = payload[name]
  if (typeof value !== 'string' || value === '') {
    throw new Error(`JWT ${name} claim is required`)
  }
  return value
}

function assertTemporalClaims(payload: Record<string, unknown>, nowSeconds: number): void {
  const exp = payload.exp
  if (typeof exp !== 'number' || !Number.isFinite(exp)) {
    throw new Error('JWT exp claim is required')
  }
  if (exp + JWT_CLOCK_SKEW_SECONDS < nowSeconds) {
    throw new Error('JWT is expired')
  }

  const nbf = payload.nbf
  if (typeof nbf === 'number' && nbf - JWT_CLOCK_SKEW_SECONDS > nowSeconds) {
    throw new Error('JWT is not yet valid')
  }

  const iat = payload.iat
  if (typeof iat === 'number' && iat - JWT_CLOCK_SKEW_SECONDS > nowSeconds) {
    throw new Error('JWT iat is in the future')
  }
}

export function verifyPlatformJwt(params: {
  token: string
  issuer: string
  audience: string
  jwks: Jwk[]
  nowSeconds?: number
}): VerifiedJwt {
  const segments = params.token.split('.')
  if (segments.length !== 3 || segments.some((part) => part === '')) {
    throw new Error('JWT must have three non-empty segments')
  }

  const [encodedHeader, encodedPayload, encodedSignature] = segments
  const header = decodeBase64UrlJson(encodedHeader)
  const payload = decodeBase64UrlJson(encodedPayload)
  const alg = header.alg
  const kid = header.kid
  if (alg !== SUPPORTED_JWT_ALG) {
    throw new Error(`JWT alg must be ${SUPPORTED_JWT_ALG}`)
  }
  if (typeof kid !== 'string' || kid === '') {
    throw new Error('JWT kid header is required')
  }

  const jwk = params.jwks.find(
    (candidate) =>
      candidate.kid === kid &&
      candidate.kty === 'RSA' &&
      (candidate.alg === undefined || candidate.alg === SUPPORTED_JWT_ALG)
  )
  if (jwk === undefined) {
    throw new Error(`JWKS key not found for kid ${kid}`)
  }

  const verifier = createVerify('RSA-SHA256')
  verifier.update(`${encodedHeader}.${encodedPayload}`)
  verifier.end()
  const publicKey = createPublicKey({ key: jwk as JsonWebKey, format: 'jwk' })
  if (!verifier.verify(publicKey, Buffer.from(encodedSignature, 'base64url'))) {
    throw new Error('JWT signature is invalid')
  }

  if (payload.iss !== params.issuer) {
    throw new Error('JWT issuer does not match platform issuer')
  }
  if (!claimIncludes(payload.aud, params.audience)) {
    throw new Error('JWT audience does not match platform audience')
  }
  assertTemporalClaims(payload, params.nowSeconds ?? Math.floor(Date.now() / 1000))

  return { header, payload }
}

export class PlatformMfaClaimError extends Error {
  constructor(
    message: string,
    readonly kind: 'nonce' | 'acr' | 'amr',
    readonly missingAmr?: string
  ) {
    super(message)
    this.name = 'PlatformMfaClaimError'
  }
}

export function assertPlatformMfaClaims(params: {
  payload: Record<string, unknown>
  requiredAcr: string
  requiredAmr: string[]
  expectedNonce: string
}): void {
  if (params.payload.nonce !== params.expectedNonce) {
    throw new PlatformMfaClaimError('OIDC nonce does not match', 'nonce')
  }
  if (params.payload.acr !== params.requiredAcr) {
    throw new PlatformMfaClaimError('required MFA acr is missing', 'acr')
  }
  const amr = claimStringArray(params.payload.amr)
  for (const required of params.requiredAmr) {
    if (!amr.includes(required)) {
      throw new PlatformMfaClaimError(`required MFA amr is missing: ${required}`, 'amr', required)
    }
  }
}
