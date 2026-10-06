/**
 * Defer table reloads requested while a table is hidden.
 *
 * Case (`useVariantData`) and cohort (`CohortTable`) tables live inside
 * KeepAlive views and, for the case view, behind the Shortlist tab. Work
 * requested while hidden (case switch, filter change, summary rebuild) must
 * not be dropped: it is remembered and replayed once the table is visible.
 * Dropping it left the case table in its reset loading state forever (P0-3,
 * ui-ux-audit-2026-10-06).
 *
 * The activation watcher uses `flush: 'post'` so same-tick `pre` watchers on
 * `active` can still observe `isPending()` before the replay clears it.
 */
import { watch, type Ref } from 'vue'

export function useDeferredReload(active: Ref<boolean>, reload: () => Promise<void> | void) {
  let pending = false

  const markPending = (): void => {
    pending = true
  }

  const requestReload = async (): Promise<void> => {
    if (!active.value) {
      pending = true
      return
    }
    pending = false
    await reload()
  }

  watch(
    active,
    (isActive) => {
      if (isActive && pending) void requestReload()
    },
    { flush: 'post' }
  )

  return { requestReload, markPending, isPending: (): boolean => pending }
}
