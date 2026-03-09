import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useAuthStore = defineStore('auth', () => {
  const currentUser = ref<{ id: number; username: string; role: string } | null>(null)
  const accountsEnabled = ref(false)

  const isAuthenticated = computed(() => currentUser.value !== null || !accountsEnabled.value)
  const isAdmin = computed(() => currentUser.value?.role === 'admin')
  const displayName = computed(() => currentUser.value?.username ?? 'anonymous')

  async function checkAccountsEnabled(): Promise<void> {
    // eslint-disable-next-line no-undef
    if (typeof window === 'undefined' || typeof window.api === 'undefined') return
    try {
      accountsEnabled.value = await window.api.auth.isAccountsEnabled()
      if (accountsEnabled.value) {
        const user = await window.api.auth.currentUser()
        if (user) {
          currentUser.value = user
        }
      }
    } catch {
      // Auth not available (e.g., no database open)
    }
  }

  async function login(
    username: string,
    password: string
  ): Promise<{ success: boolean; mustChangePassword?: boolean; locked?: boolean }> {
    const result = await window.api.auth.login(username, password)
    if (result.success && result.user) {
      currentUser.value = result.user
    }
    return result
  }

  function logout(): void {
    currentUser.value = null
    window.api.auth.logout()
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
