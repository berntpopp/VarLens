/**
 * Table loading presentation state (stale-while-revalidate).
 *
 * Splits a raw `loading` flag into what the user should see:
 *   - `firstLoad`  — nothing has been shown for this scope yet → skeleton
 *   - `refetching` — rows are on screen and being replaced → keep them
 *   - `showStale`  — delayed (150 ms / min 300 ms) dim + thin progress bar
 *   - `liveMessage` — polite screen-reader summary after each load
 *
 * Shared by the case VariantTable, the cohort CohortDataTable and the
 * Shortlist panel so all three tables behave the same (cohort parity).
 * Spec: ui-ux-audit-2026-10-06 §07 (table loading transitions).
 */
import { computed, ref, watch, type Ref } from 'vue'
import { useDelayedFlag, type DelayedFlagOptions } from './useDelayedFlag'

export interface TableLoadingStateOptions extends DelayedFlagOptions {
  loading: Ref<boolean>
  totalCount: Ref<number | null | undefined>
  /** Noun used in the live-region announcement, e.g. "variants". */
  noun?: string
}

export function useTableLoadingState(options: TableLoadingStateOptions) {
  const { loading, totalCount, noun = 'variants', ...delays } = options
  const hasLoaded = ref(false)
  const liveMessage = ref('')

  watch(loading, (now, before) => {
    if (before === true && now === false) {
      hasLoaded.value = true
      const total = totalCount.value
      liveMessage.value =
        typeof total === 'number' && Number.isFinite(total)
          ? `${total.toLocaleString()} ${noun}`
          : ''
    }
  })

  const firstLoad = computed(() => loading.value && !hasLoaded.value)
  const refetching = computed(() => loading.value && hasLoaded.value)
  const showStale = useDelayedFlag(refetching, delays)

  /** Call when the table's scope changes (e.g. another case) so it skeletons again. */
  const resetFirstLoad = (): void => {
    hasLoaded.value = false
  }

  return {
    firstLoad,
    refetching,
    showStale,
    ariaBusy: computed(() => (loading.value ? 'true' : 'false')),
    liveMessage,
    resetFirstLoad
  }
}
