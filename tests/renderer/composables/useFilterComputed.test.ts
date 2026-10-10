/**
 * Unit tests for useFilterComputed composable
 *
 * Tests active filter tracking, filter clearing, tag removal,
 * and clear-all functionality.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, computed } from 'vue'
import { withSetup } from '../../utils/test-helpers'
import { useFilterComputed } from '@renderer/composables/useFilterComputed'
import type { FilterState } from '../../../src/shared/types/filters'
import type { Tag } from '../../../src/shared/types/api'
import type { UseFilterComputedOptions } from '@renderer/composables/useFilterComputed'

function makeFilters(overrides: Partial<FilterState> = {}): FilterState {
  return {
    searchQuery: '',
    geneSymbol: '',
    consequences: [],
    funcs: [],
    clinvars: [],
    maxGnomadAf: null,
    minCadd: null,
    maxInternalAf: null,
    minCarriers: null,
    tagIds: [],
    starredOnly: false,
    hasCommentOnly: false,
    acmgClassifications: [],
    annotationScope: 'case',
    activePanelIds: [],
    panelPaddingBp: 5000,
    inheritanceModes: [],
    analysisGroupId: null,
    considerPhasing: false,
    columnFilters: {},
    ...overrides
  }
}

function makeOptions(
  filtersRef: ReturnType<typeof ref<FilterState>>,
  overrides: Partial<UseFilterComputedOptions> = {}
): UseFilterComputedOptions {
  return {
    filters: filtersRef,
    selectedImpactPresets: ref<string[]>([]),
    availableTags: computed<Tag[]>(() => []),
    resetPresets: vi.fn(),
    onResetSort: vi.fn(),
    selectedAfPreset: ref<number | null>(null),
    selectedCaddPreset: ref<number | null>(null),
    ...overrides
  }
}

describe('useFilterComputed', () => {
  let app: { unmount: () => void }

  afterEach(() => {
    if (app) app.unmount()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('hasActiveFilters', () => {
    it('returns false when no filters are active', () => {
      const [result, appInstance] = withSetup(() => {
        const filters = ref(makeFilters())
        return useFilterComputed(makeOptions(filters))
      })
      app = appInstance
      expect(result.hasActiveFilters.value).toBe(false)
    })

    it('returns true when searchQuery is set', () => {
      const [result, appInstance] = withSetup(() => {
        const filters = ref(makeFilters({ searchQuery: 'BRCA1' }))
        return useFilterComputed(makeOptions(filters))
      })
      app = appInstance
      expect(result.hasActiveFilters.value).toBe(true)
    })

    it('returns true when geneSymbol is set', () => {
      const [result, appInstance] = withSetup(() => {
        const filters = ref(makeFilters({ geneSymbol: 'TP53' }))
        return useFilterComputed(makeOptions(filters))
      })
      app = appInstance
      expect(result.hasActiveFilters.value).toBe(true)
    })

    it('returns true when consequences are selected', () => {
      const [result, appInstance] = withSetup(() => {
        const filters = ref(makeFilters({ consequences: ['HIGH'] }))
        return useFilterComputed(makeOptions(filters))
      })
      app = appInstance
      expect(result.hasActiveFilters.value).toBe(true)
    })

    it('returns true when maxGnomadAf is set and > 0', () => {
      const [result, appInstance] = withSetup(() => {
        const filters = ref(makeFilters({ maxGnomadAf: 0.01 }))
        return useFilterComputed(makeOptions(filters))
      })
      app = appInstance
      expect(result.hasActiveFilters.value).toBe(true)
    })

    it('returns true when starredOnly is true', () => {
      const [result, appInstance] = withSetup(() => {
        const filters = ref(makeFilters({ starredOnly: true }))
        return useFilterComputed(makeOptions(filters))
      })
      app = appInstance
      expect(result.hasActiveFilters.value).toBe(true)
    })

    it('returns true when impact presets are selected', () => {
      const [result, appInstance] = withSetup(() => {
        const filters = ref(makeFilters())
        const presets = ref(['HIGH', 'MODERATE'])
        return useFilterComputed(makeOptions(filters, { selectedImpactPresets: presets }))
      })
      app = appInstance
      expect(result.hasActiveFilters.value).toBe(true)
    })
  })

  describe('activeFilterCount', () => {
    it('returns 0 when no filters active', () => {
      const [result, appInstance] = withSetup(() => {
        const filters = ref(makeFilters())
        return useFilterComputed(makeOptions(filters))
      })
      app = appInstance
      expect(result.activeFilterCount.value).toBe(0)
    })

    it('counts each active filter group', () => {
      const [result, appInstance] = withSetup(() => {
        const filters = ref(
          makeFilters({
            searchQuery: 'test',
            geneSymbol: 'BRCA1',
            consequences: ['HIGH'],
            tagIds: [1, 2]
          })
        )
        return useFilterComputed(makeOptions(filters))
      })
      app = appInstance
      expect(result.activeFilterCount.value).toBe(4)
    })
  })

  describe('activeFiltersList', () => {
    it('returns empty array when no filters active', () => {
      const [result, appInstance] = withSetup(() => {
        const filters = ref(makeFilters())
        return useFilterComputed(makeOptions(filters))
      })
      app = appInstance
      expect(result.activeFiltersList.value).toEqual([])
    })

    it('includes search filter with value', () => {
      const [result, appInstance] = withSetup(() => {
        const filters = ref(makeFilters({ searchQuery: 'BRCA1' }))
        return useFilterComputed(makeOptions(filters))
      })
      app = appInstance
      const searchFilter = result.activeFiltersList.value.find((f) => f.id === 'search')
      expect(searchFilter).toBeDefined()
      expect(searchFilter!.value).toBe('BRCA1')
    })

    it('includes frequency filter with percentage', () => {
      const [result, appInstance] = withSetup(() => {
        const filters = ref(makeFilters({ maxGnomadAf: 0.01 }))
        return useFilterComputed(makeOptions(filters))
      })
      app = appInstance
      const freqFilter = result.activeFiltersList.value.find((f) => f.id === 'frequency')
      expect(freqFilter).toBeDefined()
      expect(freqFilter!.value).toBe('1.00%')
    })

    it('includes tag filter with names from available tags', () => {
      const mockTags: Tag[] = [
        { id: 1, name: 'Review', color: '#ff0000', created_at: 0, updated_at: 0 },
        { id: 2, name: 'Important', color: '#00ff00', created_at: 0, updated_at: 0 }
      ]
      const [result, appInstance] = withSetup(() => {
        const filters = ref(makeFilters({ tagIds: [1, 2] }))
        return useFilterComputed(makeOptions(filters, { availableTags: computed(() => mockTags) }))
      })
      app = appInstance
      const tagFilter = result.activeFiltersList.value.find((f) => f.id === 'tags')
      expect(tagFilter).toBeDefined()
      expect(tagFilter!.value).toBe('Review, Important')
    })
  })

  describe('isFilterGroupActive', () => {
    it('returns false for inactive group', () => {
      const [result, appInstance] = withSetup(() => {
        const filters = ref(makeFilters())
        return useFilterComputed(makeOptions(filters))
      })
      app = appInstance
      expect(result.isFilterGroupActive('search')).toBe(false)
    })

    it('returns true for active search group', () => {
      const [result, appInstance] = withSetup(() => {
        const filters = ref(makeFilters({ searchQuery: 'test' }))
        return useFilterComputed(makeOptions(filters))
      })
      app = appInstance
      expect(result.isFilterGroupActive('search')).toBe(true)
    })

    it('returns true for active frequency group', () => {
      const [result, appInstance] = withSetup(() => {
        const filters = ref(makeFilters({ maxGnomadAf: 0.01 }))
        return useFilterComputed(makeOptions(filters))
      })
      app = appInstance
      expect(result.isFilterGroupActive('frequency')).toBe(true)
    })

    it('returns false for unknown group', () => {
      const [result, appInstance] = withSetup(() => {
        const filters = ref(makeFilters())
        return useFilterComputed(makeOptions(filters))
      })
      app = appInstance
      expect(result.isFilterGroupActive('nonexistent')).toBe(false)
    })
  })

  describe('clearFilter', () => {
    it('clears search filter', () => {
      const [result, appInstance] = withSetup(() => {
        const filters = ref(makeFilters({ searchQuery: 'test' }))
        const opts = makeOptions(filters)
        return { ...useFilterComputed(opts), filters }
      })
      app = appInstance

      result.clearFilter('search')
      expect(result.filters.value.searchQuery).toBe('')
    })

    it('clears gene filter', () => {
      const [result, appInstance] = withSetup(() => {
        const filters = ref(makeFilters({ geneSymbol: 'BRCA1' }))
        const opts = makeOptions(filters)
        return { ...useFilterComputed(opts), filters }
      })
      app = appInstance

      result.clearFilter('gene')
      expect(result.filters.value.geneSymbol).toBe('')
    })

    it('clears tag filter', () => {
      const [result, appInstance] = withSetup(() => {
        const filters = ref(makeFilters({ tagIds: [1, 2] }))
        const opts = makeOptions(filters)
        return { ...useFilterComputed(opts), filters }
      })
      app = appInstance

      result.clearFilter('tags')
      expect(result.filters.value.tagIds).toEqual([])
    })

    it('clears frequency filter and resets AF preset', () => {
      const selectedAfPreset = ref<number | null>(0.01)
      const [result, appInstance] = withSetup(() => {
        const filters = ref(makeFilters({ maxGnomadAf: 0.01 }))
        const opts = makeOptions(filters, { selectedAfPreset })
        return { ...useFilterComputed(opts), filters }
      })
      app = appInstance

      result.clearFilter('frequency')
      expect(selectedAfPreset.value).toBeNull()
    })

    it('clears only the named shared field', () => {
      const [result, appInstance] = withSetup(() => {
        const filters = ref(makeFilters({ consequences: ['HIGH'], minCadd: 20 }))
        return { ...useFilterComputed(makeOptions(filters)), filters }
      })
      app = appInstance

      result.clearFilter('consequences')
      expect(result.filters.value.consequences).toEqual([])
      expect(result.filters.value.minCadd).toBe(20)
    })
  })

  describe('removeTagFilter', () => {
    it('removes a specific tag ID', () => {
      const [result, appInstance] = withSetup(() => {
        const filters = ref(makeFilters({ tagIds: [1, 2, 3] }))
        const opts = makeOptions(filters)
        return { ...useFilterComputed(opts), filters }
      })
      app = appInstance

      result.removeTagFilter(2)
      expect(result.filters.value.tagIds).toEqual([1, 3])
    })
  })

  describe('clearAllFilters', () => {
    it('resets all filters, presets, and sort', () => {
      const resetPresets = vi.fn()
      const onResetSort = vi.fn()
      const [result, appInstance] = withSetup(() => {
        const filters = ref(
          makeFilters({
            searchQuery: 'test',
            geneSymbol: 'BRCA1',
            tagIds: [1],
            starredOnly: true,
            hasCommentOnly: true
          })
        )
        const opts = makeOptions(filters, { resetPresets, onResetSort })
        return { ...useFilterComputed(opts), filters }
      })
      app = appInstance

      result.clearAllFilters()

      expect(result.filters.value.searchQuery).toBe('')
      expect(result.filters.value.geneSymbol).toBe('')
      expect(result.filters.value.tagIds).toEqual([])
      expect(result.filters.value.starredOnly).toBe(false)
      expect(result.filters.value.hasCommentOnly).toBe(false)
      expect(resetPresets).toHaveBeenCalled()
      expect(onResetSort).toHaveBeenCalled()
    })
  })
})

describe('useFilterComputed: carrier cap (#455)', () => {
  it('counts, lists, groups and clears the cap', () => {
    const [result, app] = withSetup(() => {
      const filters = ref(makeFilters({ maxCarriers: 3 }))
      return { filters, ...useFilterComputed(makeOptions(filters)) }
    })
    try {
      expect(result.hasActiveFilters.value).toBe(true)
      expect(result.activeFilterCount.value).toBe(1)
      expect(result.activeFiltersList.value).toEqual([
        { id: 'max-carriers', label: 'Seen in', value: '≤ 3 cases' }
      ])
      expect(result.isFilterGroupActive('internal-frequency')).toBe(true)

      result.clearFilter('max-carriers')

      expect(result.filters.value.maxCarriers).toBeNull()
      expect(result.hasActiveFilters.value).toBe(false)
      expect(result.isFilterGroupActive('internal-frequency')).toBe(false)
    } finally {
      app.unmount()
    }
  })

  it('treats an invalid stored cap as off', () => {
    const [result, app] = withSetup(() => {
      const filters = ref(makeFilters({ maxCarriers: 0 }))
      return useFilterComputed(makeOptions(filters))
    })
    try {
      expect(result.hasActiveFilters.value).toBe(false)
      expect(result.activeFiltersList.value).toEqual([])
    } finally {
      app.unmount()
    }
  })
})
