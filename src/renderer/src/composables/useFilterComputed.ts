/**
 * Composable for filter computed properties and manipulation
 *
 * Encapsulates active filter tracking (count, list, per-group check),
 * filter clearing, tag removal, and clear-all functionality.
 * Extracted from useFilterState for modularity.
 */

import { computed, type Ref, type ComputedRef } from 'vue'
import type { FilterState, ActiveFilter } from '../../../shared/types/filters'
import { resetAdapterFields } from './filter-types'
import type { Tag } from '../../../shared/types/database-entities'

/**
 * Options for useFilterComputed
 */
export interface UseFilterComputedOptions {
  /** Reactive filter state */
  filters: Ref<FilterState>
  /** Selected impact presets */
  selectedImpactPresets: Ref<string[]>
  /** Available tags for label resolution */
  availableTags: ComputedRef<Tag[]>
  /** Reset presets to defaults */
  resetPresets: () => void
  /** Callback to reset sort order in parent */
  onResetSort: () => void
  /** Selected AF preset ref (cleared on frequency filter clear) */
  selectedAfPreset: Ref<number | null>
  /** Selected CADD preset ref (cleared on CADD filter clear) */
  selectedCaddPreset: Ref<number | null>
}

/**
 * Return type for useFilterComputed composable
 */
export interface UseFilterComputedReturn {
  /** Whether any filter is currently active */
  hasActiveFilters: ComputedRef<boolean>
  /** Count of active filter groups */
  activeFilterCount: ComputedRef<number>
  /** List of active filters with labels and values */
  activeFiltersList: ComputedRef<ActiveFilter[]>
  /** Check if a specific filter group is active */
  isFilterGroupActive: (groupId: string) => boolean
  /** Clear a single filter by ID */
  clearFilter: (filterId: string) => void
  /** Remove a specific tag from the tag filter */
  removeTagFilter: (tagId: number) => void
  /** Clear all filters and reset sort */
  clearAllFilters: () => void
}

/**
 * Composable for filter computed properties and manipulation
 *
 * @param options - Filter state, presets, and callbacks
 * @returns Computed properties and filter manipulation methods
 */
export function useFilterComputed(options: UseFilterComputedOptions): UseFilterComputedReturn {
  const {
    filters,
    selectedImpactPresets,
    availableTags,
    resetPresets,
    onResetSort,
    selectedAfPreset,
    selectedCaddPreset
  } = options

  // ---------------------------------------------------------------------------
  // Computed properties
  // ---------------------------------------------------------------------------

  const hasActiveFilters = computed(() => {
    const afActive =
      filters.value.maxGnomadAf !== null &&
      Number.isNaN(filters.value.maxGnomadAf) === false &&
      filters.value.maxGnomadAf > 0
    const caddActive =
      filters.value.minCadd !== null &&
      Number.isNaN(filters.value.minCadd) === false &&
      filters.value.minCadd >= 0
    const internalAfActive =
      filters.value.maxInternalAf !== null &&
      Number.isNaN(filters.value.maxInternalAf) === false &&
      filters.value.maxInternalAf > 0

    return (
      filters.value.searchQuery !== '' ||
      (filters.value.geneSymbol != null && filters.value.geneSymbol !== '') ||
      selectedImpactPresets.value.length > 0 ||
      filters.value.consequences.length > 0 ||
      filters.value.funcs.length > 0 ||
      filters.value.clinvars.length > 0 ||
      afActive ||
      caddActive ||
      internalAfActive ||
      filters.value.tagIds.length > 0 ||
      filters.value.starredOnly ||
      filters.value.hasCommentOnly ||
      filters.value.acmgClassifications.length > 0 ||
      filters.value.activePanelIds.length > 0 ||
      filters.value.inheritanceModes.length > 0
    )
  })

  const activeFilterCount = computed(() => {
    let count = 0
    if (filters.value.searchQuery !== '') count++
    if (filters.value.geneSymbol != null && filters.value.geneSymbol !== '') count++
    if (selectedImpactPresets.value.length > 0) count++
    if (filters.value.consequences.length > 0) count++
    if (filters.value.funcs.length > 0) count++
    if (filters.value.clinvars.length > 0) count++
    if (
      filters.value.maxGnomadAf !== null &&
      !Number.isNaN(filters.value.maxGnomadAf) &&
      filters.value.maxGnomadAf > 0
    )
      count++
    if (
      filters.value.minCadd !== null &&
      !Number.isNaN(filters.value.minCadd) &&
      filters.value.minCadd >= 0
    )
      count++
    if (
      filters.value.maxInternalAf !== null &&
      !Number.isNaN(filters.value.maxInternalAf) &&
      filters.value.maxInternalAf > 0
    )
      count++
    if (filters.value.tagIds.length > 0) count++
    if (filters.value.starredOnly) count++
    if (filters.value.hasCommentOnly) count++
    if (filters.value.acmgClassifications.length > 0) count++
    if (filters.value.activePanelIds.length > 0) count++
    if (filters.value.inheritanceModes.length > 0) count++
    return count
  })

  const activeFiltersList = computed<ActiveFilter[]>(() => {
    const list: ActiveFilter[] = []

    if (filters.value.searchQuery !== '') {
      list.push({ id: 'search', label: 'Search', value: filters.value.searchQuery })
    }
    if (filters.value.geneSymbol != null && filters.value.geneSymbol !== '') {
      list.push({ id: 'gene', label: 'Gene', value: filters.value.geneSymbol })
    }
    if (selectedImpactPresets.value.length > 0) {
      list.push({ id: 'impact', label: 'Impact', value: selectedImpactPresets.value.join(', ') })
    }
    if (filters.value.consequences.length > 0) {
      list.push({
        id: 'consequences',
        label: 'Impact',
        value: `${filters.value.consequences.length} selected`
      })
    }
    if (filters.value.funcs.length > 0) {
      list.push({
        id: 'funcs',
        label: 'Consequence',
        value: `${filters.value.funcs.length} selected`
      })
    }
    if (filters.value.clinvars.length > 0) {
      list.push({
        id: 'clinvars',
        label: 'ClinVar',
        value: `${filters.value.clinvars.length} selected`
      })
    }
    if (
      filters.value.maxGnomadAf !== null &&
      !Number.isNaN(filters.value.maxGnomadAf) &&
      filters.value.maxGnomadAf > 0
    ) {
      const pct = (filters.value.maxGnomadAf * 100).toFixed(2)
      list.push({ id: 'frequency', label: 'AF \u2264', value: `${pct}%` })
    }
    if (
      filters.value.minCadd !== null &&
      !Number.isNaN(filters.value.minCadd) &&
      filters.value.minCadd >= 0
    ) {
      list.push({ id: 'cadd', label: 'CADD \u2265', value: String(filters.value.minCadd) })
    }
    if (
      filters.value.maxInternalAf !== null &&
      !Number.isNaN(filters.value.maxInternalAf) &&
      filters.value.maxInternalAf > 0
    ) {
      const pct = (filters.value.maxInternalAf * 100).toFixed(2)
      list.push({ id: 'internal-frequency', label: 'Internal AF \u2264', value: `${pct}%` })
    }
    if (filters.value.tagIds.length > 0) {
      const tagNames = availableTags.value
        .filter((t) => filters.value.tagIds.includes(t.id))
        .map((t) => t.name)
      list.push({ id: 'tags', label: 'Tags', value: tagNames.join(', ') })
    }
    if (filters.value.starredOnly) {
      list.push({ id: 'starred', label: 'Starred', value: 'only' })
    }
    if (filters.value.hasCommentOnly) {
      list.push({ id: 'commented', label: 'Commented', value: 'only' })
    }
    if (filters.value.acmgClassifications.length > 0) {
      list.push({
        id: 'acmg',
        label: 'ACMG',
        value: filters.value.acmgClassifications.join(', ')
      })
    }
    if (filters.value.annotationScope === 'all') {
      list.push({ id: 'annotationScope', label: 'Scope', value: 'All (global)' })
    }
    if (filters.value.activePanelIds.length > 0) {
      list.push({
        id: 'panels',
        label: 'Panels',
        value: `${filters.value.activePanelIds.length} panel(s)`
      })
    }
    if (filters.value.inheritanceModes.length > 0) {
      list.push({
        id: 'inheritance',
        label: 'Inheritance',
        value: filters.value.inheritanceModes.join(', ')
      })
    }

    return list
  })

  // ---------------------------------------------------------------------------
  // Filter group active check
  // ---------------------------------------------------------------------------

  const isFilterGroupActive = (groupId: string): boolean => {
    switch (groupId) {
      case 'search':
        return filters.value.searchQuery !== ''
      case 'gene':
        return filters.value.geneSymbol != null && filters.value.geneSymbol !== ''
      case 'impact':
        return selectedImpactPresets.value.length > 0 || filters.value.consequences.length > 0
      case 'function':
        return filters.value.funcs.length > 0
      case 'clinvar':
        return filters.value.clinvars.length > 0
      case 'frequency':
        return (
          filters.value.maxGnomadAf !== null &&
          !Number.isNaN(filters.value.maxGnomadAf) &&
          filters.value.maxGnomadAf > 0
        )
      case 'internal-frequency':
        return (
          filters.value.maxInternalAf !== null &&
          !Number.isNaN(filters.value.maxInternalAf) &&
          filters.value.maxInternalAf > 0
        )
      case 'cadd':
        return (
          filters.value.minCadd !== null &&
          !Number.isNaN(filters.value.minCadd) &&
          filters.value.minCadd >= 0
        )
      case 'tags':
        return filters.value.tagIds.length > 0
      case 'annotations':
        return (
          filters.value.starredOnly ||
          filters.value.hasCommentOnly ||
          filters.value.acmgClassifications.length > 0
        )
      case 'panels':
        return filters.value.activePanelIds.length > 0
      case 'inheritance':
        return filters.value.inheritanceModes.length > 0
      default:
        return false
    }
  }

  // ---------------------------------------------------------------------------
  // Filter manipulation
  // ---------------------------------------------------------------------------

  const clearFilter = (filterId: string): void => {
    switch (filterId) {
      case 'search':
        filters.value.searchQuery = ''
        break
      case 'gene':
        filters.value.geneSymbol = ''
        break
      case 'consequences':
        filters.value.consequences = []
        break
      case 'funcs':
        filters.value.funcs = []
        break
      case 'clinvars':
        filters.value.clinvars = []
        break
      case 'acmg':
        filters.value.acmgClassifications = []
        break
      case 'internal-frequency':
        filters.value.maxInternalAf = null
        break
      case 'impact':
        selectedImpactPresets.value = []
        break
      case 'frequency':
        filters.value.maxGnomadAf = null
        selectedAfPreset.value = null
        break
      case 'cadd':
        filters.value.minCadd = null
        selectedCaddPreset.value = null
        break
      case 'tags':
        filters.value.tagIds = []
        break
      case 'starred':
        filters.value.starredOnly = false
        break
      case 'commented':
        filters.value.hasCommentOnly = false
        break
      case 'annotationScope':
        filters.value.annotationScope = 'case'
        break
      case 'panels':
        filters.value.activePanelIds = []
        filters.value.panelPaddingBp = 5000
        break
      case 'inheritance':
        filters.value.inheritanceModes = []
        filters.value.analysisGroupId = null
        filters.value.considerPhasing = false
        break
    }
  }

  const removeTagFilter = (tagId: number): void => {
    filters.value.tagIds = filters.value.tagIds.filter((id) => id !== tagId)
  }

  const clearAllFilters = (): void => {
    resetAdapterFields(filters)
    resetPresets()
    // Also reset sort order in parent
    onResetSort()
  }

  return {
    hasActiveFilters,
    activeFilterCount,
    activeFiltersList,
    isFilterGroupActive,
    clearFilter,
    removeTagFilter,
    clearAllFilters
  }
}
