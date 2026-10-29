/**
 * The desktop platform sign-in state (#295), loaded before anything renders.
 *
 * `required` decides whether main.ts mounts the app or the sign-in screen.
 * The main process enforces the sign-in on every IPC call; this store only
 * picks what to show, so a failed load falls back to the app, where every
 * data call is refused anyway while signing in is required.
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import type { DesktopAuthStatus } from '../../../shared/auth/desktop-auth-status'
import { formatErrorMessage } from '../../../shared/errors/format-error-message'
import { unwrapIpcResult } from '../../../shared/types/errors'
import { useApiService } from '../composables/useApiService'
import { logService } from '../services/LogService'
import { useCapabilityStore } from './capabilityStore'

export const useDesktopAuthStore = defineStore('desktopAuth', () => {
  const status = ref<DesktopAuthStatus>({ mode: 'none' })

  /** True while the app may not show data: the sign-in screen renders instead. */
  const required = computed(
    () => status.value.mode === 'platform' && status.value.state !== 'signed-in'
  )

  async function load(): Promise<void> {
    if (!useCapabilityStore().canUse('desktopSignIn')) return
    try {
      const { api } = useApiService()
      if (api === undefined) return
      status.value = unwrapIpcResult(await api.auth.desktopStatus())
    } catch (error) {
      logService.warn(
        `Desktop sign-in state failed to load: ${formatErrorMessage(error, 'unknown error')}`,
        'auth'
      )
    }
  }

  return { status, required, load }
})
