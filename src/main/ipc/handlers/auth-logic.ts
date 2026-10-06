/**
 * Pure business logic for auth IPC handlers.
 *
 * All functions take explicit dependencies (db) as parameters
 * and never touch IPC/Electron APIs directly.
 */
import { DEFAULT_USER_ROLE, type UserRole } from '../../../shared/auth/auth-constants'
import type { DatabaseService } from '../../database/DatabaseService'

/**
 * Authenticate a user and set them as the current user on success.
 */
export async function login(
  username: string,
  password: string,
  getDb: () => DatabaseService
): Promise<unknown> {
  const db = getDb()
  const result = await db.auth.authenticate(username, password)
  if (result.success && result.user) {
    db.setCurrentUser({
      id: result.user.id,
      username: result.user.username,
      role: result.user.role
    })
  }
  return result
}

/**
 * Log out the current user.
 */
export function logout(getDb: () => DatabaseService): void {
  const db = getDb()
  db.setCurrentUser(null)
}

/**
 * Get the currently authenticated user.
 */
export function getCurrentUser(getDb: () => DatabaseService): unknown {
  const db = getDb()
  return db.user
}

/**
 * Check whether accounts/authentication is enabled for this database.
 */
export function isAccountsEnabled(getDb: () => DatabaseService): unknown {
  const db = getDb()
  return db.isAccountsEnabled()
}

/**
 * Create a new user. Only admins can perform this action.
 */
export async function createUser(
  username: string,
  displayName: string,
  tempPassword: string,
  getDb: () => DatabaseService,
  role: UserRole = DEFAULT_USER_ROLE
): Promise<unknown> {
  const db = getDb()
  const currentUser = db.user
  if (!currentUser || currentUser.role !== 'admin') {
    throw new Error('Only admins can create users')
  }
  return db.auth.createUser(username, displayName, tempPassword, currentUser.username, role)
}

/**
 * List all users. Only admins can perform this action.
 */
export function listUsers(getDb: () => DatabaseService): unknown {
  const db = getDb()
  const currentUser = db.user
  if (!currentUser || currentUser.role !== 'admin') {
    throw new Error('Only admins can list users')
  }
  return db.auth.listUsers()
}

/**
 * Deactivate a user. Only admins can perform this action. Cannot deactivate self.
 */
export async function deactivateUser(
  username: string,
  getDb: () => DatabaseService
): Promise<void> {
  const db = getDb()
  const currentUser = db.user
  if (!currentUser || currentUser.role !== 'admin') {
    throw new Error('Only admins can deactivate users')
  }
  if (currentUser.username === username) {
    throw new Error('Cannot deactivate yourself')
  }
  await db.auth.deactivateUser(username)
}

/**
 * Re-enable a deactivated user. Only admins can perform this action.
 */
export async function reactivateUser(
  username: string,
  getDb: () => DatabaseService
): Promise<void> {
  const db = getDb()
  const currentUser = db.user
  if (!currentUser || currentUser.role !== 'admin') {
    throw new Error('Only admins can re-activate users')
  }
  await db.auth.reactivateUser(username)
}

/**
 * Change a user's role. Only admins; cannot change own role.
 */
export function setRole(username: string, role: UserRole, getDb: () => DatabaseService): void {
  const db = getDb()
  const currentUser = db.user
  if (!currentUser || currentUser.role !== 'admin') {
    throw new Error('Only admins can change roles')
  }
  if (currentUser.username === username) {
    throw new Error('Cannot change your own role')
  }
  db.auth.setRole(username, role)
}

/**
 * Reset a user's password. Only admins can perform this action.
 */
export async function resetPassword(
  username: string,
  newPassword: string,
  getDb: () => DatabaseService
): Promise<void> {
  const db = getDb()
  const currentUser = db.user
  if (!currentUser || currentUser.role !== 'admin') {
    throw new Error('Only admins can reset passwords')
  }
  await db.auth.resetPassword(username, newPassword)
}

/**
 * Change the current user's password.
 */
export async function changePassword(
  oldPassword: string,
  newPassword: string,
  getDb: () => DatabaseService
): Promise<void> {
  const db = getDb()
  const currentUser = db.user
  if (!currentUser) {
    throw new Error('Not authenticated')
  }
  const success = await db.auth.changePassword(currentUser.username, oldPassword, newPassword)
  if (!success) {
    throw new Error('Invalid current password')
  }
}
