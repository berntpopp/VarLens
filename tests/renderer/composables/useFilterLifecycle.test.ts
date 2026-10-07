/**
 * Unit tests for useFilterLifecycle composable
 *
 * Tests case-switch reset, initial search setup, and
 * case ID change watcher behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, nextTick } from 'vue'
import { withSetup, flushPromises } from '../../utils/test-helpers'
import { useFilterLifecycle } from '@renderer/composables/useFilterLifecycle'
import { useFilterCore } from '@renderer/composables/useFilterCore'
import type { FilterState } from '../../../src/shared/types/filters'
import type { UseFilterLifecycleOptions } from '@renderer/composables/useFilterLifecycle'

function makeFilters(overrides: Partial<FilterState> = {}): FilterState {
  return {
    searchQuery: 'test',
    geneSymbol: 'BRCA1',
    consequences: ['HIGH'],
    funcs: ['missense_variant'],
    clinvars: ['Pathogenic'],
    maxGnomadAf: 0.01,
    minCadd: 15,
    maxInternalAf: 0.05,
    minCarriers: null,
    tagIds: [1, 2],
    starredOnly: true,
    hasCommentOnly: true,
    acmgClassifications: ['Pathogenic'],
    annotationScope: 'all',
    activePanelIds: [1],
    panelPaddingBp: 10000,
    inheritanceModes: ['autosomal_dominant'],
    analysisGroupId: 5,
    considerPhasing: true,
    columnFilters: {},
    ...overrides
  }
}

function makeOptions(
  core: ReturnType<typeof useFilterCore>,
  filtersRef: ReturnType<typeof ref<FilterState>>,
  caseIdRef: ReturnType<typeof ref<number>>,
  overrides: Partial<UseFilterLifecycleOptions> = {}
): UseFilterLifecycleOptions {
  return {
    caseIdRef,
    filters: filtersRef,
    core,
    syncCoreToFilters: vi.fn(),
    resetPresets: vi.fn(),
    onFiltersUpdate: vi.fn(),
    onCaseSwitch: vi.fn(),
    loadFilterOptions: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

describe('useFilterLifecycle', () => {
  let app: { unmount: () => void }

  afterEach(() => {
    if (app) app.unmount()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('resetForCaseSwitch', () => {
    it('resets all adapter-specific fields', () => {
      const [result, appInstance] = withSetup(() => {
        const core = useFilterCore()
        const filters = ref(makeFilters())
        const caseIdRef = ref(1)
        const syncCoreToFilters = vi.fn()
        const resetPresets = vi.fn()
        const opts = makeOptions(core, filters, caseIdRef, {
          syncCoreToFilters,
          resetPresets
        })
        return { ...useFilterLifecycle(opts), filters, syncCoreToFilters, resetPresets }
      })
      app = appInstance

      result.resetForCaseSwitch()

      expect(result.filters.value.searchQuery).toBe('')
      expect(result.filters.value.geneSymbol).toBe('')
      expect(result.filters.value.tagIds).toEqual([])
      expect(result.filters.value.starredOnly).toBe(false)
      expect(result.filters.value.hasCommentOnly).toBe(false)
      expect(result.filters.value.annotationScope).toBe('case')
      expect(result.filters.value.activePanelIds).toEqual([])
      expect(result.filters.value.panelPaddingBp).toBe(5000)
      expect(result.filters.value.inheritanceModes).toEqual([])
      expect(result.filters.value.analysisGroupId).toBeNull()
      expect(result.filters.value.considerPhasing).toBe(false)
    })

    it('calls core.reset and syncCoreToFilters', () => {
      const syncCoreToFilters = vi.fn()
      const [result, appInstance] = withSetup(() => {
        const core = useFilterCore()
        const filters = ref(makeFilters())
        const caseIdRef = ref(1)
        const opts = makeOptions(core, filters, caseIdRef, { syncCoreToFilters })
        return { ...useFilterLifecycle(opts), syncCoreToFilters }
      })
      app = appInstance

      result.resetForCaseSwitch()
      expect(result.syncCoreToFilters).toHaveBeenCalled()
    })

    it('calls resetPresets', () => {
      const resetPresets = vi.fn()
      const [result, appInstance] = withSetup(() => {
        const core = useFilterCore()
        const filters = ref(makeFilters())
        const caseIdRef = ref(1)
        const opts = makeOptions(core, filters, caseIdRef, { resetPresets })
        return { ...useFilterLifecycle(opts), resetPresets }
      })
      app = appInstance

      result.resetForCaseSwitch()
      expect(result.resetPresets).toHaveBeenCalled()
    })
  })

  describe('setInitialSearch', () => {
    it('sets searchQuery from provided string', () => {
      const [result, appInstance] = withSetup(() => {
        const core = useFilterCore()
        const filters = ref(makeFilters({ searchQuery: '' }))
        const caseIdRef = ref(1)
        const opts = makeOptions(core, filters, caseIdRef)
        return { ...useFilterLifecycle(opts), filters }
      })
      app = appInstance

      result.setInitialSearch('chr1:12345')
      expect(result.filters.value.searchQuery).toBe('chr1:12345')
    })

    it('does not set empty search', () => {
      const [result, appInstance] = withSetup(() => {
        const core = useFilterCore()
        const filters = ref(makeFilters({ searchQuery: 'existing' }))
        const caseIdRef = ref(1)
        const opts = makeOptions(core, filters, caseIdRef)
        return { ...useFilterLifecycle(opts), filters }
      })
      app = appInstance

      result.setInitialSearch('')
      expect(result.filters.value.searchQuery).toBe('existing')
    })
  })

  describe('case ID watcher', () => {
    it('triggers reset and reload on case change', async () => {
      const onFiltersUpdate = vi.fn()
      const onCaseSwitch = vi.fn()
      const loadFilterOptions = vi.fn().mockResolvedValue(undefined)

      const [result, appInstance] = withSetup(() => {
        const core = useFilterCore()
        const filters = ref(makeFilters())
        const caseIdRef = ref(1)
        const opts = makeOptions(core, filters, caseIdRef, {
          onFiltersUpdate,
          onCaseSwitch,
          loadFilterOptions
        })
        return { ...useFilterLifecycle(opts), caseIdRef, filters }
      })
      app = appInstance

      // Change case ID
      result.caseIdRef.value = 2
      await nextTick()
      await flushPromises()

      expect(onCaseSwitch).toHaveBeenCalled()
      expect(onFiltersUpdate).toHaveBeenCalledWith({})
      expect(loadFilterOptions).toHaveBeenCalledTimes(1)
      // Filters should be reset
      expect(result.filters.value.searchQuery).toBe('')
    })

    it('does not trigger on initial mount (oldCaseId is undefined)', async () => {
      // The watcher condition checks: newCaseId !== oldCaseId && oldCaseId !== undefined
      // On initial mount, oldCaseId is undefined so it should NOT trigger
      const onCaseSwitch = vi.fn()
      const loadFilterOptions = vi.fn().mockResolvedValue(undefined)

      const [, appInstance] = withSetup(() => {
        const core = useFilterCore()
        const filters = ref(makeFilters())
        const caseIdRef = ref(1)
        const opts = makeOptions(core, filters, caseIdRef, {
          onCaseSwitch,
          loadFilterOptions
        })
        return useFilterLifecycle(opts)
      })
      app = appInstance

      await nextTick()
      await flushPromises()

      expect(onCaseSwitch).not.toHaveBeenCalled()
      expect(loadFilterOptions).not.toHaveBeenCalled()
    })

    it('does not trigger when same case ID is set', async () => {
      const onCaseSwitch = vi.fn()

      const [result, appInstance] = withSetup(() => {
        const core = useFilterCore()
        const filters = ref(makeFilters())
        const caseIdRef = ref(1)
        const opts = makeOptions(core, filters, caseIdRef, { onCaseSwitch })
        return { ...useFilterLifecycle(opts), caseIdRef }
      })
      app = appInstance

      result.caseIdRef.value = 1
      await nextTick()
      await flushPromises()

      expect(onCaseSwitch).not.toHaveBeenCalled()
    })
  })
})
