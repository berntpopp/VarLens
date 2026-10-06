/**
 * Latch for lazy-mounting heavy overlays (drawers, dialogs, modals).
 *
 * A `defineAsyncComponent` that is rendered unconditionally still downloads
 * its chunk — and runs its watchers/fetches — on first render, even while
 * its `v-model` is `false`. Gate the component with `v-if="mounted"` instead:
 * `mounted` flips to `true` the first time `isOpen()` is truthy and then
 * stays `true`, so the component keeps its state (and its close transition)
 * after the first open.
 */
import { readonly, ref, watch, type Ref } from 'vue'

export function useMountOnFirstOpen(isOpen: () => boolean): Readonly<Ref<boolean>> {
  const mounted = ref(isOpen())
  if (!mounted.value) {
    const stop = watch(
      isOpen,
      (open) => {
        if (!open) return
        mounted.value = true
        stop()
      },
      { flush: 'sync' }
    )
  }
  return readonly(mounted)
}
