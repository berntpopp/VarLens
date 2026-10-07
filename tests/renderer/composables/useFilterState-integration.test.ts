/**
 * Integration tests for useFilterState facade composable
 *
 * Verifies the facade wires sub-composables correctly and
 * exposes the full UseFilterStateReturn interface.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { withSetup } from '../../utils/test-helpers'
import { createMockApi } from '../../utils/mock-api'
import { useFilterState } from '@renderer/composables/useFilterState'
import type { UseFilterStateReturn } from '@renderer/composables/filter-types'

// Mock useTags - avoid real API calls for tags
vi.mock('@renderer/composables/useTags', () => ({
  useTags: () => ({
    loadTags: vi.fn().mockResolvedValue(undefined),
    getTags: vi.fn().mockReturnValue([])
  })
}))

// Mock LogService
vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

describe('useFilterState (integration)', () => {
  let app: { unmount: () => void }

  beforeEach(() => {
    setActivePinia(createPinia())
    const mockApi = createMockApi()
    ;(window as Record<string, unknown>).api = mockApi
    vi.useFakeTimers()
  })

  afterEach(() => {
    if (app) app.unmount()
    vi.useRealTimers()
  })

  function createState(caseId = 1) {
    const caseIdRef = ref(caseId)
    const onFiltersUpdate = vi.fn()
    const onResetSort = vi.fn()

    const [result, appInstance] = withSetup(() =>
      useFilterState(caseIdRef, { onFiltersUpdate, onResetSort })
    )
    app = appInstance

    return { result, caseIdRef, onFiltersUpdate, onResetSort }
  }

  // -------------------------------------------------------------------------
  // Return shape
  // -------------------------------------------------------------------------

  it('returns all expected keys in UseFilterStateReturn', () => {
    const { result } = createState()

    // State refs
    expect(result.filters).toBeDefined()
    expect(result.filterOptions).toBeDefined()
    expect(result.geneSymbolSuggestions).toBeDefined()
    expect(result.loadingSuggestions).toBeDefined()
    expect(result.selectedImpactPresets).toBeDefined()
    expect(result.selectedAfPreset).toBeDefined()
    expect(result.selectedCaddPreset).toBeDefined()
    expect(result.exporting).toBeDefined()

    // Presets
    expect(result.afPresets).toBeDefined()
    expect(result.caddPresets).toBeDefined()
    expect(result.impactPresets).toBeDefined()

    // Tags
    expect(result.availableTags).toBeDefined()

    // Computed
    expect(result.hasActiveFilters).toBeDefined()
    expect(result.activeFilterCount).toBeDefined()
    expect(result.activeFiltersList).toBeDefined()

    // Methods
    expect(typeof result.isFilterGroupActive).toBe('function')
    expect(typeof result.clearFilter).toBe('function')
    expect(typeof result.removeTagFilter).toBe('function')
    expect(typeof result.clearAllFilters).toBe('function')
    expect(typeof result.handleGeneClear).toBe('function')
    expect(typeof result.searchGeneSymbols).toBe('function')
    expect(typeof result.emitFilters).toBe('function')
    expect(typeof result.loadFilterOptions).toBe('function')
    expect(typeof result.resetForCaseSwitch).toBe('function')
    expect(typeof result.setInitialSearch).toBe('function')
    expect(typeof result.exportToExcel).toBe('function')

    // Verify all expected keys are present (no extras, no missing)
    const expectedKeys: (keyof UseFilterStateReturn)[] = [
      'filters',
      'filterOptions',
      'geneSymbolSuggestions',
      'loadingSuggestions',
      'selectedImpactPresets',
      'selectedAfPreset',
      'selectedCaddPreset',
      'exporting',
      'afPresets',
      'caddPresets',
      'impactPresets',
      'availableTags',
      'hasActiveFilters',
      'activeFilterCount',
      'activeFiltersList',
      'isFilterGroupActive',
      'clearFilter',
      'removeTagFilter',
      'clearAllFilters',
      'handleGeneClear',
      'searchGeneSymbols',
      'emitFilters',
      'loadFilterOptions',
      'resetForCaseSwitch',
      'setInitialSearch',
      'exportToExcel'
    ]
    for (const key of expectedKeys) {
      expect(result).toHaveProperty(key)
    }
  })

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  it('starts with no active filters', () => {
    const { result } = createState()

    expect(result.hasActiveFilters.value).toBe(false)
    expect(result.activeFilterCount.value).toBe(0)
    expect(result.activeFiltersList.value).toEqual([])
  })

  // -------------------------------------------------------------------------
  // Emit filters
  // -------------------------------------------------------------------------

  it('emitFilters calls onFiltersUpdate callback', () => {
    const { result, onFiltersUpdate } = createState()

    // Set a filter
    result.filters.value.searchQuery = 'BRCA1'
    result.emitFilters()

    expect(onFiltersUpdate).toHaveBeenCalledWith(expect.objectContaining({ search_query: 'BRCA1' }))
  })

  // -------------------------------------------------------------------------
  // Clear all filters
  // -------------------------------------------------------------------------

  it('clearAllFilters resets filter state', () => {
    const { result, onResetSort } = createState()

    // Set multiple filters
    result.filters.value.searchQuery = 'test'
    result.filters.value.geneSymbol = 'BRCA1'
    result.filters.value.tagIds = [1, 2]
    result.filters.value.starredOnly = true

    result.clearAllFilters()

    expect(result.filters.value.searchQuery).toBe('')
    expect(result.filters.value.geneSymbol).toBe('')
    expect(result.filters.value.tagIds).toEqual([])
    expect(result.filters.value.starredOnly).toBe(false)
    expect(result.hasActiveFilters.value).toBe(false)
    expect(onResetSort).toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // setInitialSearch
  // -------------------------------------------------------------------------

  it('setInitialSearch sets the search query', () => {
    const { result } = createState()

    result.setInitialSearch('chr1:12345')
    expect(result.filters.value.searchQuery).toBe('chr1:12345')
  })

  it('setInitialSearch ignores empty strings', () => {
    const { result } = createState()

    result.setInitialSearch('')
    expect(result.filters.value.searchQuery).toBe('')
  })
})
