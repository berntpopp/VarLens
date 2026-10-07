/**
 * Filter options (consequences, funcs, ClinVar values, numeric ranges) of the
 * current case, read from the query cache (`queries/filter-options.ts`).
 */

import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { useQuery } from '@pinia/colada'
import type { FilterOptions } from '../../../shared/types/api'
import { filterOptionsQuery } from '../queries/filter-options'
import { loadIfAllowed } from '../queries/gate'

/** Shown until the case's options have loaded, and when they cannot be. */
const NO_FILTER_OPTIONS: FilterOptions = {
  consequences: [],
  funcs: [],
  clinvars: [],
  minCadd: null,
  maxCadd: null,
  minGnomadAf: null,
  maxGnomadAf: null,
  columnMeta: []
}

export interface UseFilterOptionsCacheReturn {
  /** Filter options of the current case */
  filterOptions: ComputedRef<FilterOptions>
  /** Resolves once the current case's options have loaded (or failed) */
  loadFilterOptions: () => Promise<void>
}

export function useFilterOptionsCache(
  caseId: MaybeRefOrGetter<number>
): UseFilterOptionsCacheReturn {
  const { data, refresh } = useQuery(() => filterOptionsQuery(toValue(caseId)))

  return {
    filterOptions: computed(() => data.value ?? NO_FILTER_OPTIONS),
    loadFilterOptions: () => loadIfAllowed('variants.filterOptions', refresh)
  }
}
