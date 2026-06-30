/**
 * Web-mode session + auth gate.
 *
 * Stateless signed-encrypted cookie sessions via @fastify/secure-session.
 * The cookie holds `{ user: { id, username, role, passwordChangedAt } }`
 * plus the password-rotation sticky bit; there is no server-side
 * session store. Each protected API request revalidates the cookie
 * against the current DB user row so deactivation, password reset
 * or platform-entitlement revocation invalidates stale sessions
 * before they reach application logic.
 *
 * Secret resolution, in order:
 *
 *   1. `VARLENS_SESSION_SECRET_HEX` env var (64 hex chars = 32 bytes)
 *   2. `<recoveryKeyDir>/web-session-secret` file (created on first
 *      boot, mode 0600)
 *
 * The recovery-key dir defaults to `/data` (same as the admin
 * recovery key) so a single mounted volume covers both secrets.
 *
 * preHandler gate: any request whose path starts with `/api/` is
 * 401'd unless `request.session.user` is present, with public exceptions:
 *
 *   - `/api/auth/login`
 *   - `/api/auth/isAccountsEnabled`
 *   - `/api/openapi.json`
 *   - `/api/docs` and `/api/docs/*`
 *
 * `/healthz` and static assets bypass the gate naturally because
 * they don't start with `/api/`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { isAbsolute, join } from 'path'
import { randomBytes } from 'crypto'

import type { FastifyInstance } from 'fastify'
import secureSession from '@fastify/secure-session'

import type { PostgresWebAuthService } from '../auth/PostgresWebAuthService'
import type { PlatformIdentityService } from './platform-identity'
import { registerAuthLoginRateLimit } from './rate-limit'

declare module '@fastify/secure-session' {
  interface SessionData {
    user: { id: number; username: string; role: string; passwordChangedAt: string | null }
    authMode?: 'local' | 'platform'
    platformOidc?: Record<
      string,
      {
        nonce: string
        codeVerifier: string
        next: string
        createdAt: number
      }
    >
    /**
     * Sticky bit set on login when the authenticated user has
     * must_change_password=TRUE in the DB; cleared by the
     * auth:changePassword override on success. The dispatcher's
     * pre-rotation gate reads this directly from the session so
     * every request doesn't have to re-query the DB.
     */
    mustChangePassword: boolean
  }
}

const DEFAULT_RECOVERY_KEY_DIR = '/data'
const SESSION_SECRET_FILENAME = 'web-session-secret'

/**
 * Cookie name. In production we use the `__Host-` prefix, which the
 * browser binds to:
 *   - Path=/ (we set this)
 *   - Secure (we set this)
 *   - no Domain attribute (we don't set Domain)
 *
 * Browsers reject `__Host-` cookies that don't satisfy all three, so
 * the prefix turns "I configured this cookie correctly" into a
 * runtime invariant. Dev (HTTP) drops the prefix because Secure
 * isn't possible there.
 */
function resolveSessionCookieName(): string {
  return isProductionMode() ? '__Host-varlens.sid' : 'varlens.sid'
}

/**
 * Production mode = anything but explicit dev. We default-deny
 * insecurity: only NODE_ENV=development relaxes Secure, and only
 * NODE_ENV=test relaxes it for the test runner. Anything else
 * (including missing NODE_ENV in a packaged image) gets the
 * production cookie posture.
 */
function isProductionMode(): boolean {
  const env = process.env.NODE_ENV
  return env !== 'development' && env !== 'test'
}

const PUBLIC_API_PATHS = new Set<string>([
  '/api/auth/login',
  '/api/auth/isAccountsEnabled',
  '/api/openapi.json',
  '/api/docs'
])
const PUBLIC_API_PREFIXES = ['/api/docs/']
const UNSAFE_METHODS = new Set<string>(['POST', 'PUT', 'PATCH', 'DELETE'])

export function isPublicApiPath(path: string): boolean {
  return PUBLIC_API_PATHS.has(path) || PUBLIC_API_PREFIXES.some((prefix) => path.startsWith(prefix))
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

export function isAllowedApiOrigin(params: {
  origin: string | undefined
  host: string | undefined
  protocol: string
}): boolean {
  if (params.origin === undefined || params.origin.trim() === '') return false
  if (params.host === undefined || params.host.trim() === '') return false

  try {
    const origin = new URL(params.origin)
    return origin.host === params.host && origin.protocol === `${params.protocol}:`
  } catch {
    return false
  }
}

export function isAllowedUnsafeApiRequest(params: {
  secFetchSite: string | undefined
  origin: string | undefined
  host: string | undefined
  protocol: string
}): boolean {
  const secFetchSite = params.secFetchSite?.trim().toLowerCase()
  if (secFetchSite === 'same-origin' || secFetchSite === 'same-site') return true
  if (secFetchSite !== undefined && secFetchSite !== '') return false

  return isAllowedApiOrigin({
    origin: params.origin,
    host: params.host,
    protocol: params.protocol
  })
}

function resolveRecoveryKeyDir(): string {
  const raw = process.env.VARLENS_RECOVERY_KEY_DIR
  const dir = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : DEFAULT_RECOVERY_KEY_DIR
  if (!isAbsolute(dir)) {
    throw new Error(
      `VARLENS_RECOVERY_KEY_DIR must be an absolute path; got: ${JSON.stringify(dir)}`
    )
  }
  return dir
}

function loadOrCreateSessionKey(): Buffer {
  const fromEnv = process.env.VARLENS_SESSION_SECRET_HEX
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    const buf = Buffer.from(fromEnv.trim(), 'hex')
    if (buf.length !== 32) {
      throw new Error(
        `VARLENS_SESSION_SECRET_HEX must decode to exactly 32 bytes; got ${buf.length}`
      )
    }
    return buf
  }

  const dir = resolveRecoveryKeyDir()
  const path = join(dir, SESSION_SECRET_FILENAME)
  if (existsSync(path)) {
    const buf = readFileSync(path)
    if (buf.length !== 32) {
      throw new Error(
        `Session-secret file at ${path} is corrupt: expected 32 bytes, got ${buf.length}. ` +
          'Delete the file to regenerate (this invalidates all current sessions).'
      )
    }
    return buf
  }

  // Generate-on-first-boot. Persisting it means restarts don't sign
  // every user out — important for a single-tenant deployment.
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const generated = randomBytes(32)
  writeFileSync(path, generated, { mode: 0o600 })
  return generated
}

export async function registerSessions(
  app: FastifyInstance,
  options: { authService: PostgresWebAuthService; platformIdentity?: PlatformIdentityService }
): Promise<void> {
  const key = loadOrCreateSessionKey()
  const production = isProductionMode()
  const platformMode = options.platformIdentity !== undefined

  await app.register(secureSession, {
    key,
    cookieName: resolveSessionCookieName(),
    cookie: {
      path: '/',
      httpOnly: true,
      // Local login has no cross-site flow, so Strict is viable.
      // Platform OIDC needs Lax so the top-level GET callback from
      // the IdP carries the transient state/nonce session.
      sameSite: platformMode ? 'lax' : 'strict',
      // Production: Secure is non-negotiable — `__Host-` prefix
      // *requires* Secure, and we never want a session cookie
      // travelling over HTTP. Dev / test: drop Secure so localhost
      // HTTP works; the cookie name also drops the __Host- prefix
      // there so browsers don't reject the Set-Cookie outright.
      secure: production,
      // 4h max-age. An admin tool that's used in burst sessions
      // doesn't need a multi-day cookie; the shorter window limits
      // exposure if a laptop is briefly unattended. Re-login is
      // cheap.
      maxAge: 60 * 60 * 4
    }
  })

  app.addHook('preHandler', async (request, reply) => {
    const url = request.url
    // Strip query string for the gate decision.
    const path = url.split('?', 1)[0]

    if (!path.startsWith('/api/')) return

    if (
      UNSAFE_METHODS.has(request.method) &&
      !isAllowedUnsafeApiRequest({
        secFetchSite: headerValue(request.headers['sec-fetch-site']),
        origin: headerValue(request.headers.origin),
        host: headerValue(request.headers.host),
        protocol: headerValue(request.headers['x-forwarded-proto']) ?? request.protocol
      })
    ) {
      reply.code(403)
      return reply.send({
        code: 'FORBIDDEN_ORIGIN',
        message: 'request origin is not allowed',
        userMessage: 'Request origin is not allowed.'
      })
    }

    if (isPublicApiPath(path)) return

    if (request.session.user === undefined) {
      reply.code(401)
      return reply.send({
        code: 'UNAUTHENTICATED',
        message: 'authentication required',
        userMessage: 'Please log in to continue.'
      })
    }

    const sessionUser = request.session.user
    const liveUser = await options.authService.getUser(sessionUser.username)
    if (
      liveUser === undefined ||
      liveUser.id !== sessionUser.id ||
      liveUser.is_active !== 1 ||
      liveUser.password_changed_at !== sessionUser.passwordChangedAt
    ) {
      request.session.delete()
      reply.code(401)
      return reply.send({
        code: 'UNAUTHENTICATED',
        message: 'session no longer valid',
        userMessage: 'Please log in again.'
      })
    }

    if (platformMode && request.session.authMode !== 'platform') {
      request.session.delete()
      reply.code(401)
      return reply.send({
        code: 'UNAUTHENTICATED',
        message: 'platform login is required',
        userMessage: 'Please log in again.'
      })
    }

    if (request.session.authMode === 'platform') {
      if (options.platformIdentity === undefined) {
        request.session.delete()
        reply.code(401)
        return reply.send({
          code: 'UNAUTHENTICATED',
          message: 'platform identity is not configured',
          userMessage: 'Please log in again.'
        })
      }
      try {
        const platformUser = await options.platformIdentity.resolveSessionUser(
          options.authService,
          sessionUser.username
        )
        if (platformUser.id !== sessionUser.id) {
          throw new Error('platform user id changed')
        }
        request.session.mustChangePassword = false
        request.session.user = platformUser
      } catch {
        request.session.delete()
        reply.code(401)
        return reply.send({
          code: 'UNAUTHENTICATED',
          message: 'platform session no longer valid',
          userMessage: 'Please log in again.'
        })
      }
      return
    }

    request.session.mustChangePassword = liveUser.must_change_password === 1
    request.session.user = {
      id: liveUser.id,
      username: liveUser.username,
      role: liveUser.role,
      passwordChangedAt: liveUser.password_changed_at
    }
  })

  registerAuthLoginRateLimit(app)
}
