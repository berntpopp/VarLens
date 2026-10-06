/**
 * Per-request principal for handler code (spec §4.1, Limin L3).
 *
 * The transport mount (web dispatcher today; IPC once handler factories land)
 * resolves the caller once and runs the handler inside
 * `runWithRequestContext`. Handlers and audit helpers read the actor from
 * here, never from call arguments, so a client cannot choose who an action
 * is attributed to.
 *
 * Node-only (AsyncLocalStorage); never import Electron here.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

import { ROLE_ADMIN, type UserRole } from '../../shared/auth/auth-constants'

export interface RequestActor {
  /** users.id; 0 for the desktop local principal. */
  id: number
  username: string
  role: UserRole
}

export interface RequestContext {
  actor: RequestActor
  runtime: 'desktop' | 'web'
  /** Transport request id (Fastify `request.id`) for log correlation. */
  requestId?: string
  /** Security-map key of the operation being served (`<domain>:<method>`). */
  operation?: string
}

/**
 * Desktop has no server boundary: the person at the machine owns the local
 * database, so the desktop principal holds every role.
 */
export const LOCAL_DESKTOP_PRINCIPAL: Readonly<RequestActor> = Object.freeze({
  id: 0,
  username: 'local',
  role: ROLE_ADMIN
})

const storage = new AsyncLocalStorage<RequestContext>()

export function runWithRequestContext<T>(context: RequestContext, callback: () => T): T {
  return storage.run(context, callback)
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore()
}

/** The authenticated actor of the current request, if any. */
export function currentRequestActor(): RequestActor | undefined {
  return storage.getStore()?.actor
}

/**
 * Username recorded on audit rows. Inside a request the authenticated
 * principal always wins over any value a caller passes in.
 */
export function auditActorName(fallback?: string | null): string | null {
  return storage.getStore()?.actor.username ?? fallback ?? null
}
