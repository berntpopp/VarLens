import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useApiService } from '../composables/useApiService'
import { logService } from '../services/LogService'

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
      accountsEnabled.value = await api.auth.isAccountsEnabled()
      if (accountsEnabled.value) {
        const user = await api.auth.currentUser()
        if (user !== null && user !== undefined) {
          currentUser.value = user
        }
      }
    } catch (e) {
      logService.warn('Auth check failed: ' + (e instanceof Error ? e.message : String(e)), 'auth')
    }
  }

  async function login(
    username: string,
    password: string
  ): Promise<{ success: boolean; mustChangePassword?: boolean; locked?: boolean }> {
    if (!api) {
      return { success: false }
    }
    const result = await api.auth.login(username, password)
    if (result.success === true && result.user !== null && result.user !== undefined) {
      currentUser.value = result.user
    }
    return result
  }

  function logout(): void {
    currentUser.value = null
    if (!api) return
    api.auth.logout().catch(() => {})
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
