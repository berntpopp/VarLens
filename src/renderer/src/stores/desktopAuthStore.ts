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

import type {
  DesktopAuthStatus,
  DesktopSignInResult
} from '../../../shared/auth/desktop-auth-status'
import { formatErrorMessage } from '../../../shared/errors/format-error-message'
import { unwrapIpcResult } from '../../../shared/types/errors'
import { useApiService } from '../composables/useApiService'
import { logService } from '../services/LogService'
import { useCapabilityStore } from './capabilityStore'

export const useDesktopAuthStore = defineStore('desktopAuth', () => {
  const status = ref<DesktopAuthStatus>({ mode: 'none' })
  /** True while VarLens waits for the browser. */
  const signingIn = ref(false)
  const lastResult = ref<DesktopSignInResult | null>(null)

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

  /** Start the sign-in in the system browser; main reloads the window on success. */
  async function signIn(): Promise<void> {
    if (!useCapabilityStore().canUse('desktopSignIn') || signingIn.value) return
    const { api } = useApiService()
    if (api === undefined) return
    signingIn.value = true
    lastResult.value = null
    try {
      lastResult.value = unwrapIpcResult(await api.auth.desktopSignIn())
    } catch (error) {
      lastResult.value = { outcome: 'failed', message: formatErrorMessage(error, 'unknown error') }
    } finally {
      signingIn.value = false
    }
  }

  /** Run a call that only logs when it fails: the buttons have nothing to show. */
  async function bestEffort(action: string, call: () => Promise<unknown>): Promise<void> {
    if (!useCapabilityStore().canUse('desktopSignIn')) return
    try {
      unwrapIpcResult(await call())
    } catch (error) {
      logService.warn(`${action} failed: ${formatErrorMessage(error, 'unknown error')}`, 'auth')
    }
  }

  async function cancelSignIn(): Promise<void> {
    const { api } = useApiService()
    if (api !== undefined) await bestEffort('Cancelling the sign-in', api.auth.desktopCancelSignIn)
  }

  /** Lock the signed-in session; main reloads the window into the sign-in screen. */
  async function lock(): Promise<void> {
    const { api } = useApiService()
    if (api !== undefined) await bestEffort('Locking VarLens', api.auth.desktopLock)
  }

  return { status, required, signingIn, lastResult, load, signIn, cancelSignIn, lock }
})
