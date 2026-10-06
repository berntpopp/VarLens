import { ChangePasswordArgsSchema, LoginArgsSchema } from '../../../shared/api/schemas/auth'
import { PasswordPolicyError } from '../../auth/PostgresWebAuthService'
import { recordAuthAudit } from '../audit'
import { isPlatformIdentityEnabled } from '../platform-identity-config'
import type { OverrideHandler } from './types'

function platformMutationDenied(reply: { code: (statusCode: number) => unknown }): {
  success: false
  error: string
  message: string
} {
  reply.code(403)
  return {
    success: false,
    error: 'platform-auth-required',
    message: 'Local password and user mutations are disabled while platform identity is active.'
  }
}

export function buildAuthOverrides(): Record<string, OverrideHandler> {
  return {
    'auth:login': {
      public: true,
      async handle(args, request, reply, deps) {
        if (isPlatformIdentityEnabled()) {
          reply.code(403)
          return {
            success: false,
            error: 'platform-auth-required',
            message: 'Username/password login is disabled while platform identity is active.'
          }
        }
        const { authService } = deps
        const parsed = LoginArgsSchema.safeParse(args)
        if (!parsed.success) {
          deps.metrics?.recordOperationEvent({
            operation: 'auth-login',
            result: 'error',
            failureClass: 'validation'
          })
          reply.code(400)
          return { error: 'username and password (string) required' }
        }
        const [username, password] = parsed.data
        const result = await authService.authenticate(username, password)
        if (result.success && result.user !== null) {
          const { id, username: name, role, password_changed_at: passwordChangedAt } = result.user
          request.session.user = { id, username: name, role, passwordChangedAt }
          request.session.mustChangePassword = result.mustChangePassword === true
          await recordAuthAudit(deps, {
            action_type: 'auth_login_success',
            username: name,
            role,
            success: true,
            mustChangePassword: result.mustChangePassword === true
          })
          deps.metrics?.recordOperationEvent({ operation: 'auth-login', result: 'success' })
        } else {
          const reason = result.locked === true ? 'locked' : 'invalid-credentials'
          await recordAuthAudit(deps, {
            action_type: 'auth_login_failure',
            username,
            success: false,
            reason
          })
          deps.metrics?.recordOperationEvent({
            operation: 'auth-login',
            result: 'error',
            failureClass: reason
          })
        }
        return result
      }
    },
    'auth:logout': {
      async handle(_args, request, _reply, deps) {
        const username = request.session.user?.username
        if (username !== undefined) {
          await recordAuthAudit(deps, {
            action_type: 'auth_logout',
            username,
            actor: username,
            success: true
          })
        }
        request.session.delete()
        return { ok: true }
      }
    },
    'auth:currentUser': {
      async handle(_args, request) {
        return request.session?.user ?? null
      }
    },
    'auth:isAccountsEnabled': {
      public: true,
      async handle(_args, _request, _reply, { authService }) {
        if (isPlatformIdentityEnabled()) return true
        return await authService.isAccountsEnabled()
      }
    },
    'auth:changePassword': {
      async handle(args, request, reply, deps) {
        if (isPlatformIdentityEnabled()) {
          return platformMutationDenied(reply)
        }
        const { authService } = deps
        const session = request.session
        const sessionUser = session?.user
        if (sessionUser === undefined) {
          reply.code(401)
          return { error: 'authentication required' }
        }

        const parsed = ChangePasswordArgsSchema.safeParse(args)
        if (!parsed.success) {
          deps.metrics?.recordOperationEvent({
            operation: 'auth-change-password',
            result: 'error',
            failureClass: 'validation'
          })
          reply.code(400)
          return { error: 'oldPassword and newPassword (string) required' }
        }
        const [oldPassword, newPassword] = parsed.data

        try {
          const ok = await authService.changePassword(
            sessionUser.username,
            oldPassword,
            newPassword
          )
          if (!ok) {
            await recordAuthAudit(deps, {
              action_type: 'auth_password_change',
              username: sessionUser.username,
              actor: sessionUser.username,
              success: false,
              reason: 'old-password-invalid'
            })
            deps.metrics?.recordOperationEvent({
              operation: 'auth-change-password',
              result: 'error',
              failureClass: 'old-password-invalid'
            })
            reply.code(401)
            return { success: false, error: 'old-password-invalid' }
          }
          const refreshed = await authService.getUser(sessionUser.username)
          if (refreshed !== undefined) {
            session.user = {
              id: refreshed.id,
              username: refreshed.username,
              role: refreshed.role,
              passwordChangedAt: refreshed.password_changed_at
            }
          }
          session.mustChangePassword = false
          await recordAuthAudit(deps, {
            action_type: 'auth_password_change',
            username: sessionUser.username,
            actor: sessionUser.username,
            success: true
          })
          deps.metrics?.recordOperationEvent({
            operation: 'auth-change-password',
            result: 'success'
          })
          return { success: true }
        } catch (err) {
          if (err instanceof PasswordPolicyError) {
            await recordAuthAudit(deps, {
              action_type: 'auth_password_change',
              username: sessionUser.username,
              actor: sessionUser.username,
              success: false,
              reason: err.code
            })
            deps.metrics?.recordOperationEvent({
              operation: 'auth-change-password',
              result: 'error',
              failureClass: err.code
            })
            reply.code(422)
            return { success: false, error: err.code, message: err.message }
          }
          throw err
        }
      }
    }
  }
}
