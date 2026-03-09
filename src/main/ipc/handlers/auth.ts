import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import {
  LoginParamsSchema,
  CreateUserSchema,
  UsernameSchema,
  PasswordSchema,
  ChangePasswordSchema
} from '../../../shared/types/ipc-schemas'
import { mainLogger } from '../../services/MainLogger'

/**
 * Auth IPC handlers
 * Channels: auth:login, auth:logout, auth:currentUser, auth:isAccountsEnabled,
 *           auth:createUser, auth:listUsers, auth:deactivateUser,
 *           auth:resetPassword, auth:changePassword
 */
export function registerAuthHandlers({ ipcMain, getDb }: HandlerDependencies): void {
  ipcMain.handle('auth:login', async (_event, username: unknown, password: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = LoginParamsSchema.safeParse({ username, password })
      if (!validated.success) {
        mainLogger.error(`Invalid auth:login params: ${validated.error.message}`, 'auth')
        throw new Error('Invalid login credentials')
      }

      const db = getDb()
      const result = await db.auth.authenticate(validated.data.username, validated.data.password)
      if (result.success && result.user) {
        db.setCurrentUser({
          id: result.user.id,
          username: result.user.username,
          role: result.user.role
        })
      }
      return result
    })
  })

  ipcMain.handle('auth:logout', async () => {
    return wrapHandler(async () => {
      const db = getDb()
      db.setCurrentUser(null)
    })
  })

  ipcMain.handle('auth:currentUser', async () => {
    return wrapHandler(async () => {
      const db = getDb()
      return db.user
    })
  })

  ipcMain.handle('auth:isAccountsEnabled', async () => {
    return wrapHandler(async () => {
      const db = getDb()
      return db.isAccountsEnabled()
    })
  })

  ipcMain.handle(
    'auth:createUser',
    async (_event, username: unknown, displayName: unknown, tempPassword: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validated = CreateUserSchema.safeParse({ username, displayName, tempPassword })
        if (!validated.success) {
          mainLogger.error(`Invalid auth:createUser params: ${validated.error.message}`, 'auth')
          throw new Error('Invalid user creation parameters')
        }

        const db = getDb()
        const currentUser = db.user
        if (!currentUser || currentUser.role !== 'admin') {
          throw new Error('Only admins can create users')
        }
        return db.auth.createUser(
          validated.data.username,
          validated.data.displayName,
          validated.data.tempPassword,
          currentUser.username
        )
      })
    }
  )

  ipcMain.handle('auth:listUsers', async () => {
    return wrapHandler(async () => {
      const db = getDb()
      return db.auth.listUsers()
    })
  })

  ipcMain.handle('auth:deactivateUser', async (_event, username: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = UsernameSchema.safeParse(username)
      if (!validated.success) {
        mainLogger.error(`Invalid auth:deactivateUser username: ${validated.error.message}`, 'auth')
        throw new Error('Invalid username')
      }

      const db = getDb()
      const currentUser = db.user
      if (!currentUser || currentUser.role !== 'admin') {
        throw new Error('Only admins can deactivate users')
      }
      if (currentUser.username === validated.data) {
        throw new Error('Cannot deactivate yourself')
      }
      await db.auth.deactivateUser(validated.data)
    })
  })

  ipcMain.handle('auth:resetPassword', async (_event, username: unknown, newPassword: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
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

      const db = getDb()
      const currentUser = db.user
      if (!currentUser || currentUser.role !== 'admin') {
        throw new Error('Only admins can reset passwords')
      }
      await db.auth.resetPassword(validatedUsername.data, validatedPassword.data)
    })
  })

  ipcMain.handle(
    'auth:changePassword',
    async (_event, oldPassword: unknown, newPassword: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validated = ChangePasswordSchema.safeParse({ oldPassword, newPassword })
        if (!validated.success) {
          mainLogger.error(`Invalid auth:changePassword params: ${validated.error.message}`, 'auth')
          throw new Error('Invalid password parameters')
        }

        const db = getDb()
        const currentUser = db.user
        if (!currentUser) {
          throw new Error('Not authenticated')
        }
        const success = await db.auth.changePassword(
          currentUser.username,
          validated.data.oldPassword,
          validated.data.newPassword
        )
        if (!success) {
          throw new Error('Invalid current password')
        }
      })
    }
  )
}
