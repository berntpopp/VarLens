import { ref, type Ref } from 'vue'

import type { WindowAPI } from '../../../shared/types/api'
import { unwrapIpcResult } from '../../../shared/types/errors'

/** How often a view asks whether a stale cohort summary has been rebuilt. */
export const SUMMARY_STALE_POLL_MS = 5000

type CohortStatusApi = Pick<WindowAPI['cohort'], 'getSummaryStatus' | 'onSummaryRebuilt'>

export interface SummaryFreshnessWatch {
  /** The figures taken from the cohort summary are being refreshed. */
  stale: Ref<boolean>
  /** Subscribe to rebuild events and read the current status. */
  start: () => void
  stop: () => void
  /** A response said the summary is stale (`warnings.staleSummary`). */
  markStale: () => void
}

/**
 * Tracks whether the cohort summary is stale and calls `onFresh` once when it
 * stops being so, so a view can mark its summary figures as "being
 * refreshed" and reload them afterwards.
 *
 * Two sources, because the backends differ: desktop sends
 * `cohort:summaryRebuilt` events; PostgreSQL rebuilds in the background
 * without one, so while the summary is stale the status is asked for on a
 * timer. Used by the cohort view and the database overview alike.
 */
export function watchSummaryFreshness(options: {
  cohortApi: CohortStatusApi
  onFresh: () => void
  pollMs?: number
}): SummaryFreshnessWatch {
  const stale = ref(false)
  let timer: ReturnType<typeof setInterval> | undefined
  let unsubscribe: (() => void) | undefined

  const stopPolling = (): void => {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
  }
  const apply = (next: boolean): void => {
    const was = stale.value
    stale.value = next
    if (!next) {
      stopPolling()
      if (was) options.onFresh()
    } else if (timer === undefined) {
      timer = setInterval(() => void check(), options.pollMs ?? SUMMARY_STALE_POLL_MS)
    }
  }
  const check = async (): Promise<void> => {
    try {
      apply(unwrapIpcResult(await options.cohortApi.getSummaryStatus()).is_stale)
    } catch {
      // Keep the current state; the next tick or event decides.
    }
  }

  return {
    stale,
    start: () => {
      unsubscribe ??= options.cohortApi.onSummaryRebuilt((status) => apply(status.is_stale))
      void check()
    },
    stop: () => {
      unsubscribe?.()
      unsubscribe = undefined
      stopPolling()
    },
    markStale: () => apply(true)
  }
}
