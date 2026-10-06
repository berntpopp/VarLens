import type { FastifyRequest } from 'fastify'

import type { PostgresWebAuthService } from '../auth/PostgresWebAuthService'
import type { SessionRevocations } from './session-revocation'

/**
 * Periodic re-check of an open SSE stream's session — the same rules the
 * auth preHandler applies to every API request (auth.ts), evaluated against
 * the session snapshot the stream was opened with:
 *
 * - the browser session was logged out (revoked sid);
 * - the user was deactivated, deleted or re-created under the same name;
 * - for local accounts, the password changed (reset or rotation) since login.
 *
 * Returns the live role (so a demoted admin stops receiving other users'
 * job events) or `undefined` to close the stream.
 */
export async function revalidateStreamSession(
  request: FastifyRequest,
  authService: Pick<PostgresWebAuthService, 'getSessionUser'>,
  revocations: Pick<SessionRevocations, 'isRevoked'>
): Promise<{ role: string } | undefined> {
  const sessionUser = request.session.user
  if (sessionUser === undefined) return undefined
  if (revocations.isRevoked(request.session.sid)) return undefined

  const live = await authService.getSessionUser(sessionUser.username)
  if (live === undefined || live.id !== sessionUser.id || live.is_active !== 1) return undefined
  if (
    request.session.authMode !== 'platform' &&
    live.password_changed_at !== sessionUser.passwordChangedAt
  ) {
    return undefined
  }
  return { role: live.role }
}
