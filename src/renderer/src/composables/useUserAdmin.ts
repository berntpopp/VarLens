/**
 * Admin user-management actions (list / create / role / reset / disable /
 * re-enable) over `window.api.auth`, with user-facing error and success
 * messages. Shared by UserManagement.vue; kept separate so the behaviour is
 * unit-testable without mounting Vuetify.
 */
import { ref, type Ref } from 'vue'
import { useApiService } from './useApiService'
import { isIpcError, unwrapIpcResult } from '../../../shared/types/errors'

import { DEFAULT_USER_ROLE, type UserRole } from '../../../shared/auth/auth-constants'
import { roleLabel } from '../utils/role-labels'

export type { UserRole }

export interface ManagedUser {
  id: number
  username: string
  display_name: string | null
  role: string
  is_active: number
  must_change_password: number
  failed_login_count: number
  created_at: string
}

export interface UseUserAdminReturn {
  users: Ref<ManagedUser[]>
  busy: Ref<boolean>
  error: Ref<string>
  success: Ref<string>
  loadUsers: () => Promise<void>
  createUser: (
    username: string,
    displayName: string,
    tempPassword: string,
    role?: UserRole
  ) => Promise<boolean>
  setRole: (username: string, role: UserRole) => Promise<boolean>
  resetPassword: (username: string, newPassword: string) => Promise<boolean>
  setActive: (username: string, active: boolean) => Promise<boolean>
}

export function describeAdminError(e: unknown, fallback: string): string {
  if (isIpcError(e)) return e.userMessage ?? e.message
  if (e instanceof Error && e.message !== '') return e.message
  return fallback
}

export function useUserAdmin(): UseUserAdminReturn {
  const { api } = useApiService()
  const users = ref<ManagedUser[]>([])
  const busy = ref(false)
  const error = ref('')
  const success = ref('')

  async function loadUsers(): Promise<void> {
    if (!api) return
    try {
      users.value = unwrapIpcResult(await api.auth.listUsers())
    } catch (e) {
      error.value = describeAdminError(e, 'Failed to load users')
    }
  }

  /** Runs one mutation, reports the outcome, reloads the list on success. */
  async function run(
    action: () => Promise<unknown>,
    successMessage: string,
    fallback: string
  ): Promise<boolean> {
    if (!api) return false
    busy.value = true
    error.value = ''
    success.value = ''
    try {
      unwrapIpcResult(await action())
      success.value = successMessage
      await loadUsers()
      return true
    } catch (e) {
      error.value = describeAdminError(e, fallback)
      return false
    } finally {
      busy.value = false
    }
  }

  return {
    users,
    busy,
    error,
    success,
    loadUsers,
    createUser: (username, displayName, tempPassword, role = DEFAULT_USER_ROLE) =>
      run(
        () => api!.auth.createUser(username, displayName || username, tempPassword, role),
        `User ${username} created. They must change the temporary password at first sign-in.`,
        'Failed to create user'
      ),
    setRole: (username, role) =>
      run(
        () => api!.auth.setRole(username, role),
        `${username} is now ${role === 'admin' ? 'an' : 'a'} ${roleLabel(role)}.`,
        'Failed to change role'
      ),
    resetPassword: (username, newPassword) =>
      run(
        () => api!.auth.resetPassword(username, newPassword),
        `Password for ${username} reset. They must change it at next sign-in.`,
        'Failed to reset password'
      ),
    setActive: (username, active) =>
      run(
        () => (active ? api!.auth.reactivateUser(username) : api!.auth.deactivateUser(username)),
        active ? `${username} re-enabled.` : `${username} disabled.`,
        active ? 'Failed to re-enable user' : 'Failed to disable user'
      )
  }
}
