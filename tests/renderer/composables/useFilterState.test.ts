/**
 * Unit tests for useFilterState composable
 *
 * Tests initial state, filter manipulation, debounced emission,
 * IPC safety, case switching, filter options loading, and gene autocomplete.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { withSetup, flushPromises } from '../../utils/test-helpers'
import { createMockApi } from '../../utils/mock-api'
import { useFilterState } from '@renderer/composables/useFilterState'
import { installCapabilities } from '../helpers/capabilities'

// Mock useTags — avoid real API calls for tags
vi.mock('@renderer/composables/useTags', () => ({
  useTags: () => ({
    loadTags: vi.fn().mockResolvedValue(undefined),
    getTags: vi.fn().mockReturnValue([])
  })
}))

describe('useFilterState', () => {
  let app: { unmount: () => void }

  beforeEach(() => {
    setActivePinia(createPinia())
    installCapabilities()
    // Assign a fresh mock API — add geneSymbols which is not in base mock
    const mockApi = createMockApi()
    ;(mockApi.variants as Record<string, unknown>).geneSymbols = vi
      .fn()
      .mockResolvedValue(['BRCA1', 'BRCA2'])
    ;(window as Record<string, unknown>).api = mockApi
    vi.useFakeTimers()
  })

  afterEach(() => {
    if (app) app.unmount()
    vi.useRealTimers()
  })

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

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
  // Initial state
  // -------------------------------------------------------------------------

  describe('Initial state', () => {
    it('has empty filter strings and arrays', () => {
      const { result } = createState()

      expect(result.filters.value.searchQuery).toBe('')
      expect(result.filters.value.geneSymbol).toBe('')
      expect(result.filters.value.consequences).toEqual([])
      expect(result.filters.value.funcs).toEqual([])
      expect(result.filters.value.clinvars).toEqual([])
      expect(result.filters.value.tagIds).toEqual([])
      expect(result.filters.value.acmgClassifications).toEqual([])
      expect(result.filters.value.columnFilters).toEqual({})
    })

    it('has null numeric filters', () => {
      const { result } = createState()

      expect(result.filters.value.maxGnomadAf).toBeNull()
      expect(result.filters.value.minCadd).toBeNull()
    })

    it('has boolean filters off by default', () => {
      const { result } = createState()

      expect(result.filters.value.starredOnly).toBe(false)
      expect(result.filters.value.hasCommentOnly).toBe(false)
    })

    it('defaults annotationScope to case', () => {
      const { result } = createState()

      expect(result.filters.value.annotationScope).toBe('case')
    })

    it('hasActiveFilters is false initially', () => {
      const { result } = createState()

      expect(result.hasActiveFilters.value).toBe(false)
    })

    it('activeFilterCount is zero initially', () => {
      const { result } = createState()

      expect(result.activeFilterCount.value).toBe(0)
    })

    it('activeFiltersList is empty initially', () => {
      const { result } = createState()

      expect(result.activeFiltersList.value).toEqual([])
    })

    it('geneSymbolSuggestions is empty initially', () => {
      const { result } = createState()

      expect(result.geneSymbolSuggestions.value).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // Filter manipulation — clearFilter
  // -------------------------------------------------------------------------

  describe('clearFilter', () => {
    it('clears searchQuery', () => {
      const { result } = createState()
      result.filters.value.searchQuery = 'BRCA1'

      result.clearFilter('search')

      expect(result.filters.value.searchQuery).toBe('')
    })

    it('clears geneSymbol', () => {
      const { result } = createState()
      result.filters.value.geneSymbol = 'TP53'

      result.clearFilter('gene')

      expect(result.filters.value.geneSymbol).toBe('')
    })

    it('clears consequences', () => {
      const { result } = createState()
      result.filters.value.consequences = ['missense_variant']

      result.clearFilter('consequences')

      expect(result.filters.value.consequences).toEqual([])
    })

    it('clears funcs', () => {
      const { result } = createState()
      result.filters.value.funcs = ['protein_coding']

      result.clearFilter('funcs')

      expect(result.filters.value.funcs).toEqual([])
    })

    it('clears clinvars', () => {
      const { result } = createState()
      result.filters.value.clinvars = ['Pathogenic']

      result.clearFilter('clinvars')

      expect(result.filters.value.clinvars).toEqual([])
    })

    it('clears maxGnomadAf and AF preset', () => {
      const { result } = createState()
      result.filters.value.maxGnomadAf = 0.01
      result.selectedAfPreset.value = 0.01

      result.clearFilter('frequency')

      expect(result.filters.value.maxGnomadAf).toBeNull()
      expect(result.selectedAfPreset.value).toBeNull()
    })

    it('clears minCadd and CADD preset', () => {
      const { result } = createState()
      result.filters.value.minCadd = 20
      result.selectedCaddPreset.value = 20

      result.clearFilter('cadd')

      expect(result.filters.value.minCadd).toBeNull()
      expect(result.selectedCaddPreset.value).toBeNull()
    })

    it('clears tagIds', () => {
      const { result } = createState()
      result.filters.value.tagIds = [1, 2]

      result.clearFilter('tags')

      expect(result.filters.value.tagIds).toEqual([])
    })

    it('clears starredOnly', () => {
      const { result } = createState()
      result.filters.value.starredOnly = true

      result.clearFilter('starred')

      expect(result.filters.value.starredOnly).toBe(false)
    })

    it('clears hasCommentOnly', () => {
      const { result } = createState()
      result.filters.value.hasCommentOnly = true

      result.clearFilter('commented')

      expect(result.filters.value.hasCommentOnly).toBe(false)
    })

    it('clears acmgClassifications', () => {
      const { result } = createState()
      result.filters.value.acmgClassifications = ['P', 'LP']

      result.clearFilter('acmg')

      expect(result.filters.value.acmgClassifications).toEqual([])
    })

    it('resets annotationScope to case', () => {
      const { result } = createState()
      result.filters.value.annotationScope = 'all'

      result.clearFilter('annotationScope')

      expect(result.filters.value.annotationScope).toBe('case')
    })
  })

  // -------------------------------------------------------------------------
  // Filter manipulation — clearAllFilters
  // -------------------------------------------------------------------------

  describe('clearAllFilters', () => {
    it('resets all filter fields', () => {
      const { result } = createState()

      result.filters.value.searchQuery = 'query'
      result.filters.value.geneSymbol = 'BRCA1'
      result.filters.value.consequences = ['missense_variant']
      result.filters.value.funcs = ['protein_coding']
      result.filters.value.clinvars = ['Pathogenic']
      result.filters.value.maxGnomadAf = 0.01
      result.filters.value.minCadd = 20
      result.filters.value.tagIds = [1]
      result.filters.value.starredOnly = true
      result.filters.value.hasCommentOnly = true
      result.filters.value.acmgClassifications = ['P']
      result.filters.value.annotationScope = 'all'

      result.clearAllFilters()

      expect(result.filters.value.searchQuery).toBe('')
      expect(result.filters.value.geneSymbol).toBe('')
      expect(result.filters.value.consequences).toEqual([])
      expect(result.filters.value.funcs).toEqual([])
      expect(result.filters.value.clinvars).toEqual([])
      expect(result.filters.value.maxGnomadAf).toBeNull()
      expect(result.filters.value.minCadd).toBeNull()
      expect(result.filters.value.tagIds).toEqual([])
      expect(result.filters.value.starredOnly).toBe(false)
      expect(result.filters.value.hasCommentOnly).toBe(false)
      expect(result.filters.value.acmgClassifications).toEqual([])
      expect(result.filters.value.annotationScope).toBe('case')
    })

    it('calls onResetSort', () => {
      const { result, onResetSort } = createState()

      result.clearAllFilters()

      expect(onResetSort).toHaveBeenCalledOnce()
    })

    it('activeFilterCount drops to zero after clearAllFilters', () => {
      const { result } = createState()
      result.filters.value.searchQuery = 'query'
      result.filters.value.geneSymbol = 'BRCA1'

      result.clearAllFilters()

      expect(result.activeFilterCount.value).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // removeTagFilter
  // -------------------------------------------------------------------------

  describe('removeTagFilter', () => {
    it('removes only the specified tag id', () => {
      const { result } = createState()
      result.filters.value.tagIds = [1, 2, 3]

      result.removeTagFilter(2)

      expect(result.filters.value.tagIds).toEqual([1, 3])
    })

    it('does nothing when tag id not present', () => {
      const { result } = createState()
      result.filters.value.tagIds = [1, 3]

      result.removeTagFilter(99)

      expect(result.filters.value.tagIds).toEqual([1, 3])
    })
  })

  // -------------------------------------------------------------------------
  // activeFilterCount tracking
  // -------------------------------------------------------------------------

  describe('activeFilterCount', () => {
    it('increments for each active filter group', () => {
      const { result } = createState()

      result.filters.value.searchQuery = 'q'
      expect(result.activeFilterCount.value).toBe(1)

      result.filters.value.geneSymbol = 'BRCA1'
      expect(result.activeFilterCount.value).toBe(2)

      result.filters.value.consequences = ['missense_variant']
      expect(result.activeFilterCount.value).toBe(3)

      result.filters.value.funcs = ['protein_coding']
      expect(result.activeFilterCount.value).toBe(4)

      result.filters.value.clinvars = ['Pathogenic']
      expect(result.activeFilterCount.value).toBe(5)

      result.filters.value.maxGnomadAf = 0.01
      expect(result.activeFilterCount.value).toBe(6)

      result.filters.value.minCadd = 20
      expect(result.activeFilterCount.value).toBe(7)

      result.filters.value.tagIds = [1]
      expect(result.activeFilterCount.value).toBe(8)

      result.filters.value.starredOnly = true
      expect(result.activeFilterCount.value).toBe(9)

      result.filters.value.hasCommentOnly = true
      expect(result.activeFilterCount.value).toBe(10)

      result.filters.value.acmgClassifications = ['P']
      expect(result.activeFilterCount.value).toBe(11)
    })

    it('does not count maxGnomadAf of 0', () => {
      const { result } = createState()
      result.filters.value.maxGnomadAf = 0

      expect(result.activeFilterCount.value).toBe(0)
    })

    it('counts minCadd of 0 (valid floor)', () => {
      const { result } = createState()
      result.filters.value.minCadd = 0

      expect(result.activeFilterCount.value).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // activeFiltersList
  // -------------------------------------------------------------------------

  describe('activeFiltersList', () => {
    it('adds search entry when searchQuery is set', () => {
      const { result } = createState()
      result.filters.value.searchQuery = 'BRCA1'

      const list = result.activeFiltersList.value
      expect(list.some((f) => f.id === 'search')).toBe(true)
    })

    it('adds gene entry when geneSymbol is set', () => {
      const { result } = createState()
      result.filters.value.geneSymbol = 'TP53'

      const list = result.activeFiltersList.value
      const entry = list.find((f) => f.id === 'gene')
      expect(entry).toBeDefined()
      expect(entry?.value).toBe('TP53')
    })

    it('adds frequency entry with formatted percentage', () => {
      const { result } = createState()
      result.filters.value.maxGnomadAf = 0.005

      const list = result.activeFiltersList.value
      const entry = list.find((f) => f.id === 'frequency')
      expect(entry).toBeDefined()
      expect(entry?.value).toBe('0.50%')
    })

    it('adds annotationScope entry only when set to all', () => {
      const { result } = createState()

      expect(result.activeFiltersList.value.some((f) => f.id === 'annotationScope')).toBe(false)

      result.filters.value.annotationScope = 'all'
      expect(result.activeFiltersList.value.some((f) => f.id === 'annotationScope')).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // isFilterGroupActive
  // -------------------------------------------------------------------------

  describe('isFilterGroupActive', () => {
    it('returns true for search when searchQuery is set', () => {
      const { result } = createState()
      result.filters.value.searchQuery = 'q'
      expect(result.isFilterGroupActive('search')).toBe(true)
    })

    it('returns false for unknown groupId', () => {
      const { result } = createState()
      expect(result.isFilterGroupActive('nonexistent')).toBe(false)
    })

    it('returns true for annotations when starredOnly is true', () => {
      const { result } = createState()
      result.filters.value.starredOnly = true
      expect(result.isFilterGroupActive('annotations')).toBe(true)
    })

    it('returns true for annotations when acmgClassifications is non-empty', () => {
      const { result } = createState()
      result.filters.value.acmgClassifications = ['P']
      expect(result.isFilterGroupActive('annotations')).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Filter emission — debounced onFiltersUpdate
  // -------------------------------------------------------------------------

  describe('Filter emission', () => {
    it('calls onFiltersUpdate after debounce when filter changes', async () => {
      const { result, onFiltersUpdate } = createState()

      result.filters.value.searchQuery = 'BRCA1'
      await nextTick()
      vi.advanceTimersByTime(400)
      await flushPromises()

      expect(onFiltersUpdate).toHaveBeenCalled()
    })

    it('debounces typed fields (gene symbol) by 250 ms', async () => {
      const { result, onFiltersUpdate } = createState()

      result.filters.value.geneSymbol = 'TP5'
      await nextTick()
      vi.advanceTimersByTime(100) // less than the 250 ms typed-field debounce
      expect(onFiltersUpdate).not.toHaveBeenCalled()

      vi.advanceTimersByTime(150)
      expect(onFiltersUpdate).toHaveBeenCalledOnce()
    })

    it('applies discrete changes (chips/checkboxes) immediately', async () => {
      const { result, onFiltersUpdate } = createState()

      result.filters.value.consequences = ['HIGH']
      await nextTick()

      expect(onFiltersUpdate).toHaveBeenCalledOnce()
      expect(onFiltersUpdate.mock.calls[0][0].consequences).toEqual(['HIGH'])
    })

    it('emitted filter contains search_query from searchQuery', async () => {
      const { result, onFiltersUpdate } = createState()

      result.filters.value.searchQuery = 'BRCA1'
      await nextTick()
      vi.advanceTimersByTime(400)
      await flushPromises()

      const emitted = onFiltersUpdate.mock.calls[0][0]
      expect(emitted.search_query).toBe('BRCA1')
    })

    it('emitted filter contains gene_symbol from geneSymbol', async () => {
      const { result, onFiltersUpdate } = createState()

      result.filters.value.geneSymbol = 'TP53'
      await nextTick()
      vi.advanceTimersByTime(400)
      await flushPromises()

      const emitted = onFiltersUpdate.mock.calls[0][0]
      expect(emitted.gene_symbol).toBe('TP53')
    })

    it('emitted filter object is a plain object (IPC safe — not a reactive proxy)', async () => {
      const { result, onFiltersUpdate } = createState()

      result.filters.value.searchQuery = 'test'
      await nextTick()
      vi.advanceTimersByTime(400)
      await flushPromises()

      const emitted = onFiltersUpdate.mock.calls[0][0]
      // Plain objects can be structured-cloned without throwing
      expect(() => JSON.stringify(emitted)).not.toThrow()
      // The emitted object must not be the Vue reactive proxy (different reference)
      expect(emitted).not.toBe(result.filters.value)
    })

    it('emitFilters calls onFiltersUpdate immediately (no debounce)', () => {
      const { result, onFiltersUpdate } = createState()

      result.emitFilters()

      expect(onFiltersUpdate).toHaveBeenCalledOnce()
    })

    it('emitted object omits undefined fields — empty filter is plain {}', () => {
      const { result, onFiltersUpdate } = createState()

      result.emitFilters()

      const emitted = onFiltersUpdate.mock.calls[0][0]
      expect(emitted).toEqual({})
    })

    it('emits cloned column_filters through the shared serialization path', () => {
      const { result, onFiltersUpdate } = createState()

      result.filters.value.columnFilters = {
        gene_symbol: { operator: 'like', value: 'BRCA%' }
      }

      result.emitFilters()

      const emitted = onFiltersUpdate.mock.calls[0][0]
      expect(emitted.column_filters).toEqual({
        gene_symbol: { operator: 'like', value: 'BRCA%' }
      })
      expect(emitted.column_filters).not.toBe(result.filters.value.columnFilters)
    })

    it('emitted consequences merges impact presets and custom consequences', async () => {
      const { result, onFiltersUpdate } = createState()

      // Set a custom consequence
      result.filters.value.consequences = ['splice_region_variant']
      await nextTick()
      vi.advanceTimersByTime(400)
      await flushPromises()

      const emitted = onFiltersUpdate.mock.calls[0][0]
      expect(emitted.consequences).toContain('splice_region_variant')
    })
  })

  // -------------------------------------------------------------------------
  // Case switching
  // -------------------------------------------------------------------------

  describe('Case switching', () => {
    it('resets all filters when caseId changes', async () => {
      const { result, caseIdRef } = createState(1)

      result.filters.value.searchQuery = 'query'
      result.filters.value.geneSymbol = 'BRCA1'
      result.filters.value.consequences = ['missense_variant']

      caseIdRef.value = 2
      await nextTick()
      await flushPromises()

      expect(result.filters.value.searchQuery).toBe('')
      expect(result.filters.value.geneSymbol).toBe('')
      expect(result.filters.value.consequences).toEqual([])
    })

    it('calls onFiltersUpdate with empty object immediately on case switch', async () => {
      const { caseIdRef, onFiltersUpdate } = createState(1)

      caseIdRef.value = 2
      await nextTick()
      await flushPromises()

      // onFiltersUpdate should have been called with {} (bypass debounce)
      const calls = onFiltersUpdate.mock.calls
      const emptyFilterCall = calls.find((c) => {
        const arg = c[0]
        return typeof arg === 'object' && arg !== null && Object.keys(arg).length === 0
      })
      expect(emptyFilterCall).toBeDefined()
    })

    it('does not reset on initial render (no oldCaseId change)', async () => {
      const { result } = createState(1)

      result.filters.value.searchQuery = 'initial'
      await nextTick()
      // No case switch — filters should remain
      expect(result.filters.value.searchQuery).toBe('initial')
    })

    it('loads filter options for new case on switch', async () => {
      const { caseIdRef } = createState(1)
      const mockGetFilterOptions = (window.api as Record<string, Record<string, unknown>>).variants
        .getFilterOptions as ReturnType<typeof vi.fn>

      caseIdRef.value = 2
      await nextTick()
      await flushPromises()

      expect(mockGetFilterOptions).toHaveBeenCalledWith(2)
    })
  })

  // -------------------------------------------------------------------------
  // resetForCaseSwitch
  // -------------------------------------------------------------------------

  describe('resetForCaseSwitch', () => {
    it('resets filters without calling onResetSort', () => {
      const { result, onResetSort } = createState()

      result.filters.value.searchQuery = 'test'
      result.resetForCaseSwitch()

      expect(result.filters.value.searchQuery).toBe('')
      expect(onResetSort).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // setInitialSearch
  // -------------------------------------------------------------------------

  describe('setInitialSearch', () => {
    it('sets searchQuery when a non-empty string is provided', () => {
      const { result } = createState()

      result.setInitialSearch('chr1:100')

      expect(result.filters.value.searchQuery).toBe('chr1:100')
    })

    it('does not set searchQuery for empty string', () => {
      const { result } = createState()

      result.setInitialSearch('')

      expect(result.filters.value.searchQuery).toBe('')
    })
  })

  // -------------------------------------------------------------------------
  // Filter options loading (LRU cache)
  // -------------------------------------------------------------------------

  describe('loadFilterOptions', () => {
    it('calls API getFilterOptions with the given caseId', async () => {
      const { result } = createState()
      const mockGetFilterOptions = (window.api as Record<string, Record<string, unknown>>).variants
        .getFilterOptions as ReturnType<typeof vi.fn>

      mockGetFilterOptions.mockResolvedValue({
        consequences: ['missense_variant'],
        funcs: [],
        clinvars: [],
        minCadd: null,
        maxCadd: null,
        minGnomadAf: null,
        maxGnomadAf: null,
        columnMeta: []
      })

      await result.loadFilterOptions(42)

      expect(mockGetFilterOptions).toHaveBeenCalledWith(42)
    })

    it('populates filterOptions from API response', async () => {
      const { result } = createState()
      const mockGetFilterOptions = (window.api as Record<string, Record<string, unknown>>).variants
        .getFilterOptions as ReturnType<typeof vi.fn>

      mockGetFilterOptions.mockResolvedValue({
        consequences: ['missense_variant', 'synonymous_variant'],
        funcs: ['protein_coding'],
        clinvars: ['Pathogenic'],
        minCadd: 0,
        maxCadd: 50,
        minGnomadAf: 0,
        maxGnomadAf: 1,
        columnMeta: []
      })

      await result.loadFilterOptions(42)

      expect(result.filterOptions.value.consequences).toEqual([
        'missense_variant',
        'synonymous_variant'
      ])
    })

    it('serves cached options on second call without hitting API again', async () => {
      const { result } = createState()
      const mockGetFilterOptions = (window.api as Record<string, Record<string, unknown>>).variants
        .getFilterOptions as ReturnType<typeof vi.fn>

      mockGetFilterOptions.mockResolvedValue({
        consequences: ['missense_variant'],
        funcs: [],
        clinvars: [],
        minCadd: null,
        maxCadd: null,
        minGnomadAf: null,
        maxGnomadAf: null,
        columnMeta: []
      })

      await result.loadFilterOptions(10)
      await result.loadFilterOptions(10) // second call — should use cache

      expect(mockGetFilterOptions).toHaveBeenCalledTimes(1)
    })

    it('invalidateFilterOptionsCache causes next load to re-fetch from API', async () => {
      const { result } = createState()
      const mockGetFilterOptions = (window.api as Record<string, Record<string, unknown>>).variants
        .getFilterOptions as ReturnType<typeof vi.fn>

      mockGetFilterOptions.mockResolvedValue({
        consequences: [],
        funcs: [],
        clinvars: [],
        minCadd: null,
        maxCadd: null,
        minGnomadAf: null,
        maxGnomadAf: null,
        columnMeta: []
      })

      await result.loadFilterOptions(10)
      result.invalidateFilterOptionsCache()
      await result.loadFilterOptions(10) // cache was cleared — must hit API again

      expect(mockGetFilterOptions).toHaveBeenCalledTimes(2)
    })
  })

  // -------------------------------------------------------------------------
  // Gene autocomplete
  // -------------------------------------------------------------------------

  describe('searchGeneSymbols', () => {
    it('clears suggestions for query shorter than 2 characters', async () => {
      const { result } = createState()
      result.geneSymbolSuggestions.value = ['BRCA1']

      await result.searchGeneSymbols('B')

      expect(result.geneSymbolSuggestions.value).toEqual([])
    })

    it('clears suggestions for empty query', async () => {
      const { result } = createState()
      result.geneSymbolSuggestions.value = ['BRCA1']

      await result.searchGeneSymbols('')

      expect(result.geneSymbolSuggestions.value).toEqual([])
    })

    it('calls geneSymbols API for queries of length >= 2', async () => {
      const { result } = createState()
      const mockGeneSymbols = (window.api as Record<string, Record<string, unknown>>).variants
        .geneSymbols as ReturnType<typeof vi.fn>

      mockGeneSymbols.mockResolvedValue(['BRCA1', 'BRCA2'])

      await result.searchGeneSymbols('BR')

      expect(mockGeneSymbols).toHaveBeenCalledWith(1, 'BR', 50)
    })

    it('populates geneSymbolSuggestions from API response', async () => {
      const { result } = createState()
      const mockGeneSymbols = (window.api as Record<string, Record<string, unknown>>).variants
        .geneSymbols as ReturnType<typeof vi.fn>

      mockGeneSymbols.mockResolvedValue(['BRCA1', 'BRCA2'])

      await result.searchGeneSymbols('BR')

      expect(result.geneSymbolSuggestions.value).toEqual(['BRCA1', 'BRCA2'])
    })

    it('clears suggestions on API error', async () => {
      const { result } = createState()
      const mockGeneSymbols = (window.api as Record<string, Record<string, unknown>>).variants
        .geneSymbols as ReturnType<typeof vi.fn>

      mockGeneSymbols.mockRejectedValue(new Error('network error'))
      result.geneSymbolSuggestions.value = ['stale']

      await result.searchGeneSymbols('BR')

      expect(result.geneSymbolSuggestions.value).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // handleGeneClear
  // -------------------------------------------------------------------------

  describe('handleGeneClear', () => {
    it('clears geneSymbol and suggestions', () => {
      const { result } = createState()
      result.filters.value.geneSymbol = 'BRCA1'
      result.geneSymbolSuggestions.value = ['BRCA1', 'BRCA2']

      result.handleGeneClear()

      expect(result.filters.value.geneSymbol).toBe('')
      expect(result.geneSymbolSuggestions.value).toEqual([])
    })
  })
})
