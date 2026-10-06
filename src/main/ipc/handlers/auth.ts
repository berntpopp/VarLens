import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import {
  LoginParamsSchema,
  CreateUserSchema,
  UsernameSchema,
  PasswordSchema,
  ChangePasswordSchema,
  UserRoleSchema
} from '../../../shared/types/ipc-schemas'
import { mainLogger } from '../../services/MainLogger'
import {
  login,
  logout,
  getCurrentUser,
  isAccountsEnabled,
  createUser,
  listUsers,
  deactivateUser,
  reactivateUser,
  setRole,
  resetPassword,
  changePassword
} from './auth-logic'

/**
 * Auth IPC handlers
 * Channels: auth:login, auth:logout, auth:currentUser, auth:isAccountsEnabled,
 *           auth:createUser, auth:listUsers, auth:deactivateUser,
 *           auth:reactivateUser, auth:setRole,
 *           auth:resetPassword, auth:changePassword
 */
export function registerAuthHandlers({ ipcMain, getDb }: HandlerDependencies): void {
  ipcMain.handle('auth:login', async (_event, username: unknown, password: unknown) => {
    return wrapHandler(async () => {
      const validated = LoginParamsSchema.safeParse({ username, password })
      if (!validated.success) {
        mainLogger.error(`Invalid auth:login params: ${validated.error.message}`, 'auth')
        throw new Error('Invalid login credentials')
      }
      return login(validated.data.username, validated.data.password, getDb)
    })
  })

  ipcMain.handle('auth:logout', async () => {
    return wrapHandler(async () => {
      logout(getDb)
    })
  })

  ipcMain.handle('auth:currentUser', async () => {
    return wrapHandler(async () => {
      return getCurrentUser(getDb)
    })
  })

  ipcMain.handle('auth:isAccountsEnabled', async () => {
    return wrapHandler(async () => {
      return isAccountsEnabled(getDb)
    })
  })

  ipcMain.handle(
    'auth:createUser',
    async (
      _event,
      username: unknown,
      displayName: unknown,
      tempPassword: unknown,
      role: unknown
    ) => {
      return wrapHandler(async () => {
        const validated = CreateUserSchema.safeParse({
          username,
          displayName,
          tempPassword,
          role: role ?? undefined
        })
        if (!validated.success) {
          mainLogger.error(`Invalid auth:createUser params: ${validated.error.message}`, 'auth')
          throw new Error('Invalid user creation parameters')
        }
        return createUser(
          validated.data.username,
          validated.data.displayName,
          validated.data.tempPassword,
          getDb,
          validated.data.role
        )
      })
    }
  )

  ipcMain.handle('auth:listUsers', async () => {
    return wrapHandler(async () => {
      return listUsers(getDb)
    })
  })

  ipcMain.handle('auth:deactivateUser', async (_event, username: unknown) => {
    return wrapHandler(async () => {
      const validated = UsernameSchema.safeParse(username)
      if (!validated.success) {
        mainLogger.error(`Invalid auth:deactivateUser username: ${validated.error.message}`, 'auth')
        throw new Error('Invalid username')
      }
      await deactivateUser(validated.data, getDb)
    })
  })

  ipcMain.handle('auth:reactivateUser', async (_event, username: unknown) => {
    return wrapHandler(async () => {
      const validated = UsernameSchema.safeParse(username)
      if (!validated.success) {
        mainLogger.error(`Invalid auth:reactivateUser username: ${validated.error.message}`, 'auth')
        throw new Error('Invalid username')
      }
      await reactivateUser(validated.data, getDb)
    })
  })

  ipcMain.handle('auth:setRole', async (_event, username: unknown, role: unknown) => {
    return wrapHandler(async () => {
      const validatedUsername = UsernameSchema.safeParse(username)
      const validatedRole = UserRoleSchema.safeParse(role)
      if (!validatedUsername.success || !validatedRole.success) {
        mainLogger.error('Invalid auth:setRole params', 'auth')
        throw new Error('Invalid role change parameters')
      }
      await setRole(validatedUsername.data, validatedRole.data, getDb)
    })
  })

  ipcMain.handle('auth:resetPassword', async (_event, username: unknown, newPassword: unknown) => {
    return wrapHandler(async () => {
      const validatedUsername = UsernameSchema.safeParse(username)
      if (!validatedUsername.success) {
        mainLogger.error(
          `Invalid auth:resetPassword username: ${validatedUsername.error.message}`,
          'auth'
        )
        throw new Error('Invalid username')
      }
      const validatedPassword = PasswordSchema.safeParse(newPassword)
      if (!validatedPassword.success) {
        mainLogger.error(
          `Invalid auth:resetPassword password: ${validatedPassword.error.message}`,
          'auth'
        )
        throw new Error('Invalid password')
      }
      await resetPassword(validatedUsername.data, validatedPassword.data, getDb)
    })
  })

  ipcMain.handle(
    'auth:changePassword',
    async (_event, oldPassword: unknown, newPassword: unknown) => {
      return wrapHandler(async () => {
        const validated = ChangePasswordSchema.safeParse({ oldPassword, newPassword })
        if (!validated.success) {
          mainLogger.error(`Invalid auth:changePassword params: ${validated.error.message}`, 'auth')
          throw new Error('Invalid password parameters')
        }
        await changePassword(validated.data.oldPassword, validated.data.newPassword, getDb)
      })
    }
  )
}
