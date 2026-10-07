/**
 * "Data was added while you were looking" signal.
 *
 * Bumped each time cases become visible during a running batch import.
 * Views that list data across cases (cohort) refresh in place on it. It is
 * deliberately separate from `useAppState().dataGeneration`, which views
 * treat as "everything may have changed" and answer with a full reload: a
 * sample imported by a batch must not disturb someone reading another case.
 */
import { readonly, ref, type Ref } from 'vue'

const liveDataGeneration = ref(0)

export function useLiveDataSignal(): {
  liveDataGeneration: Readonly<Ref<number>>
  notifyDataAdded: () => void
} {
  return {
    liveDataGeneration: readonly(liveDataGeneration),
    notifyDataAdded: () => {
      liveDataGeneration.value++
    }
  }
}
