/**
 * Admin-only user management overrides for the web dispatcher:
 * list, create, change role, reset password, deactivate and re-activate.
 *
 * Every mutation is admin-gated, refused while platform identity owns
 * accounts, and audited (`user_account` entity). Domain failures are mapped
 * to 4xx `{ error, message }` bodies, which the dispatcher turns into a
 * SerializableError whose `userMessage` the UI can show verbatim.
 */
import type { FastifyReply } from 'fastify'

import {
  CreateUserArgsSchema,
  ResetPasswordArgsSchema,
  SetRoleArgsSchema,
  UsernameArgsSchema
} from '../../../shared/api/schemas/auth'
import { DEFAULT_USER_ROLE, USER_ROLES } from '../../../shared/auth/auth-constants'
import { PasswordPolicyError } from '../../auth/PostgresWebAuthService'
import { UserAdminError } from '../../auth/postgres-user-admin'
import type { PasswordResetAck } from '../../../shared/ipc/domains/auth'
import { recordAuthAudit, recordUserAdminAudit } from '../audit'
import { isPlatformIdentityEnabled } from '../platform-identity-config'
import { requireAdmin } from './guards'
import type { DispatcherDeps, OverrideHandler } from './types'

interface AdminFailure {
  success: false
  error: string
  message: string
}

function fail(reply: FastifyReply, status: number, error: string, message: string): AdminFailure {
  reply.code(status)
  return { success: false, error, message }
}

function platformMutationDenied(reply: FastifyReply): AdminFailure {
  return fail(
    reply,
    403,
    'platform-auth-required',
    'Local password and user mutations are disabled while platform identity is active.'
  )
}

const PG_UNIQUE_VIOLATION = '23505'

/**
 * Same status and body whether or not the account exists, so the endpoint
 * cannot be used to enumerate usernames. Nothing is reported as done: the
 * client is told the request was accepted, and the audit row (not the
 * response) records whether a password was actually reset.
 */
function passwordResetAccepted(reply: FastifyReply): PasswordResetAck {
  reply.code(202)
  return { accepted: true }
}

/** Maps known domain errors to 4xx; anything else rethrows (500). */
function mapAdminError(reply: FastifyReply, err: unknown): AdminFailure {
  if (err instanceof PasswordPolicyError) return fail(reply, 422, err.code, err.message)
  if (err instanceof UserAdminError) {
    const status = err.code === 'user-not-found' ? 404 : err.code === 'last-admin' ? 409 : 400
    return fail(reply, status, err.code, err.message)
  }
  if ((err as { code?: unknown } | null)?.code === PG_UNIQUE_VIOLATION) {
    return fail(reply, 409, 'username-taken', 'A user with this username already exists.')
  }
  if (err instanceof Error && err.message === 'Cannot deactivate an admin user') {
    return fail(
      reply,
      400,
      'cannot-deactivate-admin',
      'Change the role to analyst or viewer before disabling.'
    )
  }
  if (err instanceof Error && err.message.startsWith('User not found')) {
    return fail(reply, 404, 'user-not-found', err.message)
  }
  throw err
}

/** End the user's SSE streams now instead of at their next heartbeat revalidation. */
async function closeEventStreamsOf(deps: DispatcherDeps, username: string): Promise<void> {
  const user = await deps.authService.getUser(username)
  if (user !== undefined) deps.events.closeUser(user.id)
}

export function buildAuthAdminOverrides(): Record<string, OverrideHandler> {
  return {
    'auth:listUsers': {
      async handle(_args, request, reply, { authService }) {
        const admin = requireAdmin(request, reply)
        if (admin === undefined) return { error: 'admin-required' }
        return await authService.listUsers()
      }
    },

    'auth:createUser': {
      async handle(args, request, reply, deps) {
        if (isPlatformIdentityEnabled()) return platformMutationDenied(reply)
        const admin = requireAdmin(request, reply)
        if (admin === undefined) return { error: 'admin-required' }
        const parsed = CreateUserArgsSchema.safeParse(args)
        if (!parsed.success) {
          return fail(
            reply,
            400,
            'invalid-user-payload',
            'Username, name and password are required.'
          )
        }
        const [username, displayName, tempPassword, requestedRole] = parsed.data
        const role = requestedRole ?? DEFAULT_USER_ROLE
        try {
          await deps.authService.createUser(
            username,
            displayName,
            tempPassword,
            admin.username,
            role
          )
        } catch (err) {
          return mapAdminError(reply, err)
        }
        await recordUserAdminAudit(deps, {
          method: 'createUser',
          username,
          actor: admin.username,
          role
        })
        return undefined
      }
    },

    'auth:setRole': {
      async handle(args, request, reply, deps) {
        if (isPlatformIdentityEnabled()) return platformMutationDenied(reply)
        const admin = requireAdmin(request, reply)
        if (admin === undefined) return { error: 'admin-required' }
        const parsed = SetRoleArgsSchema.safeParse(args)
        if (!parsed.success)
          return fail(reply, 400, 'invalid-role', `Role must be one of ${USER_ROLES.join(', ')}.`)
        const [username, role] = parsed.data
        if (username === admin.username) {
          return fail(reply, 400, 'cannot-change-own-role', 'You cannot change your own role.')
        }
        try {
          await deps.authService.setRole(username, role)
        } catch (err) {
          return mapAdminError(reply, err)
        }
        await recordUserAdminAudit(deps, {
          method: 'setRole',
          username,
          actor: admin.username,
          role
        })
        return undefined
      }
    },

    'auth:deactivateUser': {
      async handle(args, request, reply, deps) {
        if (isPlatformIdentityEnabled()) return platformMutationDenied(reply)
        const admin = requireAdmin(request, reply)
        if (admin === undefined) return { error: 'admin-required' }
        const parsed = UsernameArgsSchema.safeParse(args)
        if (!parsed.success) return fail(reply, 400, 'invalid-username', 'Invalid username.')
        const [username] = parsed.data
        if (username === admin.username) {
          return fail(reply, 400, 'cannot-deactivate-self', 'You cannot disable your own account.')
        }
        try {
          await deps.authService.deactivateUser(username)
        } catch (err) {
          return mapAdminError(reply, err)
        }
        await closeEventStreamsOf(deps, username)
        await recordAuthAudit(deps, {
          action_type: 'auth_user_deactivate',
          username,
          actor: admin.username,
          success: true
        })
        return undefined
      }
    },

    'auth:reactivateUser': {
      async handle(args, request, reply, deps) {
        if (isPlatformIdentityEnabled()) return platformMutationDenied(reply)
        const admin = requireAdmin(request, reply)
        if (admin === undefined) return { error: 'admin-required' }
        const parsed = UsernameArgsSchema.safeParse(args)
        if (!parsed.success) return fail(reply, 400, 'invalid-username', 'Invalid username.')
        const [username] = parsed.data
        try {
          await deps.authService.reactivateUser(username)
        } catch (err) {
          return mapAdminError(reply, err)
        }
        await recordUserAdminAudit(deps, {
          method: 'reactivateUser',
          username,
          actor: admin.username
        })
        return undefined
      }
    },

    'auth:resetPassword': {
      async handle(args, request, reply, deps) {
        if (isPlatformIdentityEnabled()) return platformMutationDenied(reply)
        const admin = requireAdmin(request, reply)
        if (admin === undefined) return { error: 'admin-required' }
        const parsed = ResetPasswordArgsSchema.safeParse(args)
        if (!parsed.success) {
          return fail(reply, 400, 'invalid-reset-payload', 'Username and new password required.')
        }
        const [username, newPassword] = parsed.data
        if (username === admin.username) {
          return fail(
            reply,
            400,
            'cannot-reset-self',
            'Use "Change password" for your own account.'
          )
        }
        let reset = true
        try {
          await deps.authService.resetPassword(username, newPassword)
        } catch (err) {
          if (!(err instanceof UserAdminError && err.code === 'user-not-found')) {
            return mapAdminError(reply, err)
          }
          reset = false
        }
        if (reset) await closeEventStreamsOf(deps, username)
        // The trail records what really happened; the response does not.
        await recordAuthAudit(deps, {
          action_type: 'auth_password_reset',
          username,
          actor: admin.username,
          success: reset,
          ...(reset ? {} : { reason: 'user-not-found' })
        })
        return passwordResetAccepted(reply)
      }
    }
  }
}
