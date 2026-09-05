import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import type { PostgresWebAuthService } from '../auth/PostgresWebAuthService'
import { sanitizeNextParam } from './login-route'
import {
  PlatformIdentityService,
  PlatformMfaClaimError,
  type PlatformIdentityAuditInput
} from './platform-identity'

const OIDC_STATE_TTL_MS = 10 * 60 * 1000
const MAX_PENDING_OIDC_STATES = 2

function isSafeOidcState(state: string): boolean {
  return (
    typeof state === 'string' &&
    state.length >= 1 &&
    state.length <= 128 &&
    state !== '__proto__' &&
    state !== 'constructor' &&
    state !== 'prototype' &&
    /^[A-Za-z0-9_.-]+$/.test(state)
  )
}

interface PendingOidcState {
  nonce: string
  codeVerifier: string
  next: string
  createdAt: number
  seq?: number
  mfaRetry?: boolean
}

let stateSequence = 0

function isPendingOidcState(value: unknown): value is PendingOidcState {
  if (typeof value !== 'object' || value === null) return false
  const state = value as Record<string, unknown>
  return (
    typeof state.nonce === 'string' &&
    typeof state.codeVerifier === 'string' &&
    typeof state.next === 'string' &&
    typeof state.createdAt === 'number' &&
    Number.isFinite(state.createdAt) &&
    (state.seq === undefined || typeof state.seq === 'number')
  )
}

function redirectWithNoStore(reply: FastifyReply, location: string): FastifyReply {
  reply.header('cache-control', 'no-store')
  reply.code(302)
  reply.header('location', location)
  return reply
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function platformLoginErrorHtml(retryLocationValue: string): string {
  const retryLocation = escapeHtml(retryLocationValue)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sign-in failed</title>
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
    <h1>Sign-in could not be completed</h1>
    <p>Please start sign-in again. If the problem continues, contact your VarLens operator.</p>
    <a href="${retryLocation}">Try again</a>
  </main>
</body>
</html>`
}

function sendPlatformLoginError(reply: FastifyReply, retryLocation: string): FastifyReply {
  reply.header('cache-control', 'no-store')
  reply.type('text/html; charset=utf-8')
  reply.code(401)
  return reply.send(platformLoginErrorHtml(retryLocation))
}

function activePendingOidcStates(
  states: Record<string, PendingOidcState> | undefined,
  now: number
): Record<string, PendingOidcState> {
  if (states === undefined) return Object.create(null)
  const result: Record<string, PendingOidcState> = Object.create(null)
  for (const [key, pending] of Object.entries(states)) {
    if (
      isSafeOidcState(key) &&
      isPendingOidcState(pending) &&
      now - pending.createdAt <= OIDC_STATE_TTL_MS
    ) {
      result[key] = pending
    }
  }
  return result
}

function rememberPendingOidcState(params: {
  request: FastifyRequest
  state: string
  pending: PendingOidcState
}): void {
  if (!isSafeOidcState(params.state)) return
  params.pending.seq = ++stateSequence
  const pendingStates = activePendingOidcStates(params.request.session.platformOidc, Date.now())
  pendingStates[params.state] = params.pending
  const sortedEntries = Object.entries(pendingStates)
    .sort(
      ([, left], [, right]) =>
        right.createdAt - left.createdAt || (right.seq ?? 0) - (left.seq ?? 0)
    )
    .slice(0, MAX_PENDING_OIDC_STATES)
  const bounded: Record<string, PendingOidcState> = Object.create(null)
  for (const [key, val] of sortedEntries) {
    bounded[key] = val
  }
  params.request.session.platformOidc = bounded
}

function consumePendingOidcState(
  request: FastifyRequest,
  state: string
): PendingOidcState | undefined {
  if (!isSafeOidcState(state)) return undefined
  const rawStates = request.session.platformOidc
  if (rawStates === undefined || !Object.prototype.hasOwnProperty.call(rawStates, state)) {
    return undefined
  }
  const pending = rawStates[state]
  if (!isPendingOidcState(pending)) return undefined

  const pendingStates = Object.assign(Object.create(null), rawStates) as Record<
    string,
    PendingOidcState
  >
  delete pendingStates[state]
  const activeStates = activePendingOidcStates(pendingStates, Date.now())
  request.session.platformOidc = Object.keys(activeStates).length > 0 ? activeStates : undefined
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

  app.get('/auth/platform/start', { schema: { hide: true } }, async (request, reply) => {
    const query = (request.query ?? {}) as Record<string, unknown>
    const next = sanitizeNextParam(query.next, options.appPathPrefix)
    clearAuthenticatedSession(request)
    const authorization = await options.identity.createAuthorizationUrl({
      request,
      appPathPrefix: options.appPathPrefix,
      next,
      forceFreshLogin: true
    })
    rememberPendingOidcState({
      request,
      state: authorization.state,
      pending: {
        nonce: authorization.nonce,
        codeVerifier: authorization.codeVerifier,
        next,
        createdAt: Date.now()
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
      const pending = consumePendingOidcState(request, query.state)
      if (pending === undefined) {
        await auditBestEffort({ action: 'auth_login_failure', reason: 'invalid-state' })
        if (request.session.user !== undefined) {
          const defaultTarget = options.appPathPrefix === '' ? '/' : `${options.appPathPrefix}/`
          return redirectWithNoStore(reply, defaultTarget).send()
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
        if (
          error instanceof PlatformMfaClaimError &&
          error.kind === 'amr' &&
          error.missingAmr === 'otp' &&
          pending.mfaRetry !== true
        ) {
          const authorization = await options.identity.createAuthorizationUrl({
            request,
            appPathPrefix: options.appPathPrefix,
            next: pending.next,
            forceFreshLogin: false
          })
          rememberPendingOidcState({
            request,
            state: authorization.state,
            pending: {
              nonce: authorization.nonce,
              codeVerifier: authorization.codeVerifier,
              next: pending.next,
              createdAt: Date.now(),
              mfaRetry: true
            }
          })
          await auditBestEffort({ action: 'auth_login_failure', reason: 'missing-otp-amr-retry' })
          return redirectWithNoStore(reply, authorization.authorizationUrl).send()
        }
        request.session.delete()
        const reason =
          error instanceof PlatformMfaClaimError && error.kind === 'amr'
            ? 'missing-required-amr'
            : 'platform-denied'
        request.log.warn({ err: error }, 'platform identity callback denied')
        await auditBestEffort({ action: 'auth_login_failure', reason })
        return sendPlatformLoginError(
          reply,
          options.identity.buildStartLocation(options.appPathPrefix, pending.next)
        )
      }
    }
  )
}
