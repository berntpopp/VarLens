import { ipcMain } from 'electron'
import { wrapHandler } from '../errorHandler'
import { getDatabaseService } from '../../database'

/**
 * Auth IPC handlers
 * Channels: auth:login, auth:logout, auth:currentUser, auth:isAccountsEnabled,
 *           auth:createUser, auth:listUsers, auth:deactivateUser,
 *           auth:resetPassword, auth:changePassword
 */

ipcMain.handle('auth:login', async (_event, username: string, password: string) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    const result = await db.auth.authenticate(username, password)
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
    const db = getDatabaseService()
    db.setCurrentUser(null)
  })
})

ipcMain.handle('auth:currentUser', async () => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    return db.user
  })
})

ipcMain.handle('auth:isAccountsEnabled', async () => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    return db.isAccountsEnabled()
  })
})

ipcMain.handle('auth:createUser', async (_event, username: string, displayName: string, tempPassword: string) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    const currentUser = db.user
    if (!currentUser || currentUser.role !== 'admin') {
      throw new Error('Only admins can create users')
    }
    return db.auth.createUser(username, displayName, tempPassword, currentUser.username)
  })
})

ipcMain.handle('auth:listUsers', async () => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    return db.auth.listUsers()
  })
})

ipcMain.handle('auth:deactivateUser', async (_event, username: string) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    const currentUser = db.user
    if (!currentUser || currentUser.role !== 'admin') {
      throw new Error('Only admins can deactivate users')
    }
    if (currentUser.username === username) {
      throw new Error('Cannot deactivate yourself')
    }
    await db.auth.deactivateUser(username)
  })
})

ipcMain.handle('auth:resetPassword', async (_event, username: string, newPassword: string) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    const currentUser = db.user
    if (!currentUser || currentUser.role !== 'admin') {
      throw new Error('Only admins can reset passwords')
    }
    await db.auth.resetPassword(username, newPassword)
  })
})

ipcMain.handle('auth:changePassword', async (_event, oldPassword: string, newPassword: string) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    const currentUser = db.user
    if (!currentUser) {
      throw new Error('Not authenticated')
    }
    const success = await db.auth.changePassword(currentUser.username, oldPassword, newPassword)
    if (!success) {
      throw new Error('Invalid current password')
    }
  })
})
