/**
 * Hydrates global annotations for the rows the cohort table shows.
 *
 * Mirrors the case table (`useVariantData`): every change of the visible rows
 * first invalidates the batch generation, so a batch still in flight for the
 * previous page is dropped when it resolves, then loads the new rows. The load
 * is debounced so rapid paging does not issue overlapping IPC calls.
 */

import { useAnnotations } from './useAnnotations'
import { useDebounce } from './useDebounce'
import type { VariantCoords } from './annotation-cache'

const HYDRATE_DEBOUNCE_MS = 150

export function useCohortAnnotationLoader(): { hydrate: (rows: VariantCoords[]) => void } {
  const { loadGlobalAnnotationsBatch, invalidateGlobalAnnotationGeneration } = useAnnotations()

  const { debouncedFn: debouncedLoad } = useDebounce((rows: VariantCoords[]) => {
    if (rows.length === 0) return
    void loadGlobalAnnotationsBatch(
      rows.map((v) => ({ chr: v.chr, pos: v.pos, ref: v.ref, alt: v.alt }))
    )
  }, HYDRATE_DEBOUNCE_MS)

  /** Call whenever the visible cohort rows change. */
  function hydrate(rows: VariantCoords[]): void {
    invalidateGlobalAnnotationGeneration()
    debouncedLoad(rows)
  }

  return { hydrate }
}
