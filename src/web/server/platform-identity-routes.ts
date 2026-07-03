import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import type { UserRole } from '../../shared/auth/auth-constants'
import type { PostgresWebAuthService } from '../auth/PostgresWebAuthService'
import { sanitizeNextParam } from './login-route'
import { PlatformMfaClaimError } from './platform-jwt'
import type { PlatformIdentityService } from './platform-identity'

const OIDC_STATE_TTL_MS = 10 * 60 * 1000
const MAX_PENDING_OIDC_STATES = 5

interface PendingOidcState {
  nonce: string
  codeVerifier: string
  next: string
  createdAt: number
  mfaRetry?: boolean
}

export interface PlatformIdentityAuditInput {
  action: 'auth_login_success' | 'auth_login_failure'
  subject?: string
  role?: UserRole
  reason?: string
}

function redirectWithNoStore(reply: FastifyReply, location: string): FastifyReply {
  reply.header('cache-control', 'no-store')
  reply.code(302)
  reply.header('location', location)
  return reply
}

function appendQueryParam(location: string, name: string, value: string): string {
  const separator = location.includes('?') ? '&' : '?'
  return `${location}${separator}${encodeURIComponent(name)}=${encodeURIComponent(value)}`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function platformLoginErrorHtml(params: { retryLocation: string }): string {
  const retryLocation = escapeHtml(params.retryLocation)
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Anmeldung fehlgeschlagen</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #f6f2ed;
      color: #151515;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(520px, calc(100vw - 32px));
      padding: 40px;
      border-top: 4px solid #b49a62;
      background: #fff;
      box-shadow: 0 18px 60px rgba(0, 0, 0, 0.16);
    }
    h1 {
      margin: 0 0 14px;
      font-size: 1.6rem;
      line-height: 1.2;
    }
    p {
      margin: 0 0 24px;
      line-height: 1.5;
    }
    a {
      display: inline-block;
      padding: 12px 18px;
      border-radius: 4px;
      background: #6f6755;
      color: #fff;
      font-weight: 700;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <main>
    <h1>Anmeldung konnte nicht abgeschlossen werden</h1>
    <p>Bitte starten Sie die Anmeldung erneut. Falls das Problem weiter besteht, wenden Sie sich an den LB-MAP-Support.</p>
    <a href="${retryLocation}">Erneut anmelden</a>
  </main>
</body>
</html>`
}

function sendPlatformLoginError(reply: FastifyReply, retryLocation: string): FastifyReply {
  reply.header('cache-control', 'no-store')
  reply.type('text/html; charset=utf-8')
  reply.code(401)
  return reply.send(platformLoginErrorHtml({ retryLocation }))
}

function activePendingOidcStates(
  states: Record<string, PendingOidcState> | undefined,
  now: number
): Record<string, PendingOidcState> {
  if (states === undefined) return {}
  return Object.fromEntries(
    Object.entries(states).filter(([, pending]) => now - pending.createdAt <= OIDC_STATE_TTL_MS)
  )
}

function rememberPendingOidcState(params: {
  request: FastifyRequest
  state: string
  pending: PendingOidcState
  now?: number
}): void {
  const now = params.now ?? Date.now()
  const pendingStates = activePendingOidcStates(params.request.session.platformOidc, now)
  pendingStates[params.state] = params.pending
  const bounded = Object.fromEntries(
    Object.entries(pendingStates)
      .sort(([, left], [, right]) => right.createdAt - left.createdAt)
      .slice(0, MAX_PENDING_OIDC_STATES)
  )
  params.request.session.platformOidc = bounded
}

function consumePendingOidcState(params: {
  request: FastifyRequest
  state: string
  now?: number
}): PendingOidcState | undefined {
  const now = params.now ?? Date.now()
  const pendingStates = { ...(params.request.session.platformOidc ?? {}) }
  const pending = pendingStates[params.state]
  delete pendingStates[params.state]
  const activeStates = activePendingOidcStates(pendingStates, now)
  params.request.session.platformOidc =
    Object.keys(activeStates).length > 0 ? activeStates : undefined
  return pending
}

function clearAuthenticatedSession(request: FastifyRequest): void {
  delete request.session.user
  delete request.session.authMode
  request.session.mustChangePassword = false
}

function callbackQuery(request: FastifyRequest): { code?: string; state?: string; error?: string } {
  const query = (request.query ?? {}) as Record<string, unknown>
  return {
    code: typeof query.code === 'string' ? query.code : undefined,
    state: typeof query.state === 'string' ? query.state : undefined,
    error: typeof query.error === 'string' ? query.error : undefined
  }
}

export function registerPlatformIdentityRoutes(
  app: FastifyInstance,
  options: {
    identity: PlatformIdentityService
    authService: PostgresWebAuthService
    appPathPrefix: string
    audit?: (input: PlatformIdentityAuditInput) => Promise<void>
  }
): void {
  const auditBestEffort = async (input: PlatformIdentityAuditInput): Promise<void> => {
    try {
      await options.audit?.(input)
    } catch (error) {
      app.log.warn({ err: error, action: input.action }, 'platform identity audit failed')
    }
  }

  // NB: there is deliberately no provisioning HTTP endpoint here. Minting or
  // rebinding platform users (which can grant admin or take over an existing
  // owner's workspace via the private-db secret ref) must never be reachable
  // from the request-serving runtime. Provisioning is an operator-only action
  // carried by the `provision-user` CLI (see src/web/provision-user.ts and the
  // web-11 runtime contract). The serving app only starts/completes the OIDC
  // login flow below.

  app.get('/auth/platform/start', { schema: { hide: true } }, async (request, reply) => {
    const query = (request.query ?? {}) as Record<string, unknown>
    const next = sanitizeNextParam(query.next, options.appPathPrefix)
    const mfaRetry = query.mfaRetry === '1'
    clearAuthenticatedSession(request)
    const authorization = await options.identity.createAuthorizationUrl({
      request,
      appPathPrefix: options.appPathPrefix,
      next,
      forceFreshLogin: !mfaRetry
    })
    rememberPendingOidcState({
      request,
      state: authorization.state,
      pending: {
        nonce: authorization.nonce,
        codeVerifier: authorization.codeVerifier,
        next,
        createdAt: Date.now(),
        ...(mfaRetry ? { mfaRetry: true } : {})
      }
    })
    return redirectWithNoStore(reply, authorization.authorizationUrl).send()
  })

  app.get(
    options.identity.config.callbackPath,
    { schema: { hide: true } },
    async (request, reply) => {
      const query = callbackQuery(request)
      if (query.error !== undefined) {
        await auditBestEffort({ action: 'auth_login_failure', reason: 'oidc-error' })
        request.session.delete()
        return sendPlatformLoginError(
          reply,
          options.identity.buildStartLocation(options.appPathPrefix, '')
        )
      }
      if (query.code === undefined || query.state === undefined) {
        await auditBestEffort({ action: 'auth_login_failure', reason: 'invalid-callback' })
        request.session.delete()
        return redirectWithNoStore(
          reply,
          options.identity.buildStartLocation(options.appPathPrefix, '')
        ).send()
      }
      const pending = consumePendingOidcState({ request, state: query.state })
      if (pending === undefined) {
        await auditBestEffort({ action: 'auth_login_failure', reason: 'invalid-state' })
        if (request.session.user !== undefined) {
          return redirectWithNoStore(reply, options.appPathPrefix || '/').send()
        }
        request.session.delete()
        return redirectWithNoStore(
          reply,
          options.identity.buildStartLocation(options.appPathPrefix, '')
        ).send()
      }
      if (Date.now() - pending.createdAt > OIDC_STATE_TTL_MS) {
        await auditBestEffort({ action: 'auth_login_failure', reason: 'expired-state' })
        request.session.delete()
        return redirectWithNoStore(
          reply,
          options.identity.buildStartLocation(options.appPathPrefix, '')
        ).send()
      }

      try {
        const { subject } = await options.identity.completeCallback({
          request,
          appPathPrefix: options.appPathPrefix,
          code: query.code,
          expectedNonce: pending.nonce,
          codeVerifier: pending.codeVerifier
        })
        const sessionUser = await options.identity.resolveSessionUser(options.authService, subject)
        request.session.user = sessionUser
        request.session.authMode = 'platform'
        request.session.mustChangePassword = false
        await auditBestEffort({
          action: 'auth_login_success',
          subject,
          role: sessionUser.role
        })
        return redirectWithNoStore(reply, pending.next).send()
      } catch (error) {
        request.session.delete()
        if (
          error instanceof PlatformMfaClaimError &&
          error.kind === 'amr' &&
          error.missingAmr === 'otp' &&
          pending.mfaRetry !== true
        ) {
          await auditBestEffort({ action: 'auth_login_failure', reason: 'missing-otp-amr-retry' })
          const retryLocation = appendQueryParam(
            options.identity.buildStartLocation(options.appPathPrefix, pending.next),
            'mfaRetry',
            '1'
          )
          return redirectWithNoStore(reply, retryLocation).send()
        }
        request.log.warn({ err: error }, 'platform identity callback denied')
        await auditBestEffort({ action: 'auth_login_failure', reason: 'platform-denied' })
        return sendPlatformLoginError(
          reply,
          options.identity.buildStartLocation(options.appPathPrefix, pending.next)
        )
      }
    }
  )
}
