import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useApiService } from '../composables/useApiService'
import { logService } from '../services/LogService'
import { formatErrorMessage } from '../../../shared/errors/format-error-message'
import { isIpcError, unwrapIpcResult } from '../../../shared/types/errors'

export const useAuthStore = defineStore('auth', () => {
  const { api } = useApiService()
  const currentUser = ref<{ id: number; username: string; role: string } | null>(null)
  const accountsEnabled = ref(false)

  const isAuthenticated = computed(() => currentUser.value !== null || !accountsEnabled.value)
  const isAdmin = computed(() => currentUser.value?.role === 'admin')
  const displayName = computed(() => currentUser.value?.username ?? 'anonymous')

  async function checkAccountsEnabled(): Promise<void> {
    if (!api) return
    try {
      accountsEnabled.value = unwrapIpcResult(await api.auth.isAccountsEnabled())
      if (accountsEnabled.value) {
        const user = unwrapIpcResult(await api.auth.currentUser())
        if (user !== null && user !== undefined) {
          currentUser.value = user
        }
      }
    } catch (e) {
      logService.warn(
        'Auth check failed: ' +
          (e instanceof Error
            ? e.message
            : isIpcError(e)
              ? (e.userMessage ?? e.message)
              : String(e)),
        'auth'
      )
    }
  }

  async function login(
    username: string,
    password: string
  ): Promise<{
    success: boolean
    mustChangePassword?: boolean
    locked?: boolean
    error?: string
  }> {
    if (!api) {
      return { success: false }
    }
    const result = await api.auth.login(username, password)
    // wrapHandler resolves an IpcResult even on failure — a backend fault
    // (DB down, thrown validation error, etc.) comes back shaped like a
    // SerializableError, not the { success, user? } business-logic result
    // that `authenticate()` returns for a plain wrong-password attempt.
    // Branch here so the caller can distinguish "backend error" from
    // "invalid credentials" instead of silently reading `.success` off an
    // error object (always undefined, indistinguishable from a rejected login).
    if (isIpcError(result)) {
      logService.error('Login request failed: ' + (result.userMessage ?? result.message), 'auth')
      return { success: false, error: result.userMessage ?? result.message }
    }
    if (result.success === true && result.user !== null && result.user !== undefined) {
      currentUser.value = result.user
    }
    return result
  }

  async function logout(): Promise<void> {
    if (!api) {
      currentUser.value = null
      return
    }
    try {
      unwrapIpcResult(await api.auth.logout())
      currentUser.value = null
    } catch (error) {
      logService.error(
        'Logout request failed: ' + formatErrorMessage(error, 'Unknown error'),
        'auth'
      )
      throw error
    }
  }

  return {
    currentUser,
    accountsEnabled,
    isAuthenticated,
    isAdmin,
    displayName,
    checkAccountsEnabled,
    login,
    logout
  }
})
