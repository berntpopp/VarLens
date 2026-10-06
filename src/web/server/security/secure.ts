/**
 * `secure()` — the single wrapper that applies the operation security map
 * (operation-security-map.ts) to a web call: authorization by role, the
 * request context (actor) for handler code, and the audit rule. The
 * dispatcher wraps every method with it; non-dispatcher routes call
 * `authorizeOperation()` for the same decision.
 *
 * Fail closed: an operation without a policy is refused, an unknown or
 * missing role grants nothing.
 */
import type { FastifyReply, FastifyRequest } from 'fastify'

import { normalizeUserRole, roleAtLeast } from '../../../shared/auth/auth-constants'
import { ErrorCode, type SerializableError } from '../../../shared/types/errors'
import { runWithRequestContext, type RequestActor } from '../../../main/security/request-context'
import { recordApiReadAudit, recordApiWriteAudit } from '../audit'
import type { DispatcherDeps } from '../routes/types'
import type { OperationPolicy } from './operation-policy'
import { operationPolicy } from './operation-security-map'

export type AuthorizationResult =
  | { ok: true; policy: OperationPolicy; actor: RequestActor | undefined }
  | { ok: false; status: 401 | 403 | 404; body: SerializableError }

function sessionActor(request: FastifyRequest): RequestActor | undefined {
  const user = request.session?.user
  if (user === undefined) return undefined
  const role = normalizeUserRole(user.role)
  if (role === undefined) return undefined
  return { id: user.id, username: user.username, role }
}

/**
 * Decide whether the session may call `key`. Pure: never writes the reply,
 * so the dispatcher and plain routes can shape the error their own way.
 */
export function authorizeOperation(key: string, request: FastifyRequest): AuthorizationResult {
  const policy = operationPolicy(key)
  if (policy === undefined) {
    return {
      ok: false,
      status: 404,
      body: {
        code: ErrorCode.NOT_FOUND,
        message: 'unknown method',
        userMessage: 'Unknown API method.'
      }
    }
  }
  const actor = sessionActor(request)
  if (policy.minRole === 'public') return { ok: true, policy, actor }
  if (request.session?.user === undefined) {
    return {
      ok: false,
      status: 401,
      body: {
        code: ErrorCode.UNAUTHENTICATED,
        message: 'authentication required',
        userMessage: 'Please log in to continue.'
      }
    }
  }
  if (actor === undefined || !roleAtLeast(actor.role, policy.minRole)) {
    return {
      ok: false,
      status: 403,
      body: {
        code: ErrorCode.FORBIDDEN,
        message: 'role-required',
        userMessage: `Your role does not allow this action (requires ${policy.minRole}).`,
        details: { error: 'role-required', requiredRole: policy.minRole }
      }
    }
  }
  return { ok: true, policy, actor }
}

/** Route helper: sends the 401/403 itself and returns undefined when refused. */
export function requireOperation(
  key: string,
  request: FastifyRequest,
  reply: FastifyReply
): RequestActor | undefined {
  const decision = authorizeOperation(key, request)
  if (!decision.ok) {
    void reply.code(decision.status).send(decision.body)
    return undefined
  }
  return decision.actor
}

async function applyAuditRule(
  key: string,
  policy: OperationPolicy,
  deps: DispatcherDeps,
  username: string | null
): Promise<void> {
  if (policy.audit.mode !== 'wrapper') return
  if (policy.kind === 'write') await recordApiWriteAudit(deps, { key, username })
  else await recordApiReadAudit(deps, { key, username })
}

/**
 * Authorize, run inside the request context, then audit per policy.
 *
 * `invoke` returns the value to send; it may set an error status on `reply`
 * (then no audit row is written). An audit failure surfaces as the call's
 * failure — a write must not report success without its audit row.
 */
export async function secure(
  key: string,
  request: FastifyRequest,
  reply: FastifyReply,
  deps: DispatcherDeps,
  invoke: () => Promise<unknown>,
  toError: (reply: FastifyReply, run: () => Promise<unknown>) => Promise<unknown>
): Promise<unknown> {
  const decision = authorizeOperation(key, request)
  if (!decision.ok) {
    reply.code(decision.status)
    return decision.body
  }
  const { policy, actor } = decision
  const run = (): Promise<unknown> => toError(reply, invoke)
  const result = actor
    ? await runWithRequestContext(
        { actor, runtime: 'web', requestId: request.id, operation: key },
        run
      )
    : await run()
  if (reply.statusCode >= 400) return result

  const audit = await toError(reply, () =>
    applyAuditRule(key, policy, deps, actor?.username ?? null)
  )
  return reply.statusCode >= 400 ? audit : result
}
