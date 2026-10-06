/**
 * Detects a lazily loaded chunk (route view, dialog host, …) that failed to
 * load, so the shell can say so instead of leaving a blank view (issue #452).
 *
 * Vite wraps every dynamic import in the production bundle and dispatches
 * `vite:preloadError` on `window` when the chunk or one of its dependencies
 * cannot be fetched. That is the single place all of the app's lazy imports
 * (router views, `defineAsyncComponent`, on-demand libraries) pass through.
 *
 * Recovery is a document reload, deliberately not an in-page retry: Chromium
 * keeps a failed module fetch in the document's module map, so calling the
 * same `import()` again rejects immediately without touching the network.
 * The reload is left to the user because it discards unsaved in-page state.
 * The event is not cancelled — the original rejection still reaches Vue and
 * vue-router unchanged.
 */
import { readonly, ref, type Ref } from 'vue'
import { tryOnScopeDispose } from '@vueuse/core'
import { logService } from '../services/LogService'

const PRELOAD_ERROR_EVENT = 'vite:preloadError'

export interface ChunkLoadFailure {
  /** True once any lazy chunk has failed to load in this document. */
  failed: Readonly<Ref<boolean>>
  /** Reload the document: the only way to fetch a failed chunk again. */
  reload: () => void
}

export function useChunkLoadFailure(): ChunkLoadFailure {
  const failed = ref(false)

  const onPreloadError = (event: VitePreloadErrorEvent): void => {
    const reason = event.payload instanceof Error ? event.payload.message : String(event.payload)
    logService.error(`A lazily loaded part of the app failed to load: ${reason}`, 'chunk-load')
    failed.value = true
  }

  window.addEventListener(PRELOAD_ERROR_EVENT, onPreloadError)
  tryOnScopeDispose(() => window.removeEventListener(PRELOAD_ERROR_EVENT, onPreloadError))

  return { failed: readonly(failed), reload: () => window.location.reload() }
}
