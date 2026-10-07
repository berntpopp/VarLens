/**
 * Refetch what is shown when the user comes back to the window or the network
 * comes back, where the capability document asks for it (the web workspace:
 * other users change the data and no event announces it). Elsewhere this does
 * nothing.
 *
 * Nothing in the cache goes stale by time, so the library's own focus refetch
 * would never fire. This uses the one invalidation entry point instead, which
 * also refetches the cohort scope before the data keyed by it.
 */
import { useCapabilityStore } from '../stores/capabilityStore'
import { invalidateServerData } from './invalidation'

/** Switching between windows repeatedly refetches at most this often. */
export const FOCUS_REFETCH_INTERVAL_MS = 30_000

/** @returns a function that removes the listeners */
export function installFocusRefetch(): () => void {
  let lastRefetch = Date.now()

  function refetch(): void {
    lastRefetch = Date.now()
    void invalidateServerData('data-changed')
  }
  function onVisibilityChange(): void {
    if (document.visibilityState !== 'visible' || !useCapabilityStore().refetchOnFocus) return
    if (Date.now() - lastRefetch >= FOCUS_REFETCH_INTERVAL_MS) refetch()
  }
  function onOnline(): void {
    if (useCapabilityStore().refetchOnFocus) refetch()
  }

  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('online', onOnline)
  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('online', onOnline)
  }
}
