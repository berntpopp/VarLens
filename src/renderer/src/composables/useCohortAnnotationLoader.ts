/**
 * Hydrates global annotations for the rows the cohort table shows.
 *
 * Mirrors the case table (`useVariantData`): every change of the visible rows
 * first invalidates the batch generation, so a batch still in flight for the
 * previous page is dropped when it resolves, then loads the new rows. The load
 * is debounced so rapid paging does not issue overlapping IPC calls.
 */

import { getCurrentInstance, onActivated } from 'vue'
import { useAnnotations, type UseAnnotationsOptions } from './useAnnotations'
import { useDebounce } from './useDebounce'
import type { VariantCoords } from './annotation-cache'

const HYDRATE_DEBOUNCE_MS = 150

export function useCohortAnnotationLoader(options: UseAnnotationsOptions = {}): {
  hydrate: (rows: VariantCoords[]) => void
} {
  const { loadGlobalAnnotationsBatch, invalidateGlobalAnnotationGeneration } =
    useAnnotations(options)

  const { debouncedFn: debouncedLoad } = useDebounce((rows: VariantCoords[]) => {
    if (rows.length === 0) return
    void loadGlobalAnnotationsBatch(
      rows.map((v) => ({ chr: v.chr, pos: v.pos, ref: v.ref, alt: v.alt }))
    )
  }, HYDRATE_DEBOUNCE_MS)

  let shownRows: VariantCoords[] = []
  /** Call whenever the visible cohort rows change. */
  function hydrate(rows: VariantCoords[]): void {
    shownRows = rows
    invalidateGlobalAnnotationGeneration()
    debouncedLoad(rows)
  }
  // Back from the case view (KeepAlive): a case of another build emptied the
  // cache (#577), so the rows still shown are loaded again (cached keys are skipped).
  if (getCurrentInstance() !== null) onActivated(() => hydrate(shownRows))

  return { hydrate }
}
