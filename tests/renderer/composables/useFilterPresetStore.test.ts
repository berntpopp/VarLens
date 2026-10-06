import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  useFilterPresetStore,
  __resetFilterPresetStoreForTest,
  invalidateFilterPresets
} from '../../../src/renderer/src/composables/useFilterPresetStore'
import type { FilterPreset } from '../../../src/shared/types/filter-presets'

const mockPresets: FilterPreset[] = [
  {
    id: 1,
    name: 'Rare (1%)',
    description: 'AF <= 1%',
    filterJson: { maxGnomadAf: 0.01 },
    isBuiltIn: true,
    isVisible: true,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0
  },
  {
    id: 2,
    name: 'HIGH Impact',
    description: 'HIGH only',
    filterJson: { consequences: ['HIGH'] },
    isBuiltIn: true,
    isVisible: true,
    sortOrder: 1,
    createdAt: 0,
    updatedAt: 0
  }
]

// Mock window.api.presets
const mockApi = {
  list: vi.fn().mockResolvedValue(mockPresets),
  create: vi.fn().mockImplementation(async (params) => ({
    id: 99,
    ...params,
    isBuiltIn: false,
    isVisible: true,
    sortOrder: 99,
    createdAt: Date.now(),
    updatedAt: Date.now()
  })),
  update: vi.fn().mockImplementation(async (id, updates) => ({
    ...mockPresets.find((p) => p.id === id),
    ...updates,
    updatedAt: Date.now()
  })),
  delete: vi.fn().mockResolvedValue(undefined),
  reorder: vi.fn().mockResolvedValue(undefined)
}

vi.stubGlobal('window', { api: { presets: mockApi } })

describe('useFilterPresetStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The store is now a module-level singleton so callers share state.
    // Reset shared refs before every test to preserve the original
    // "fresh store per test" contract these tests were written against.
    __resetFilterPresetStoreForTest()
  })

  it('loads presets on init', async () => {
    const { presets, loadPresets } = useFilterPresetStore()
    await loadPresets()
    expect(presets.value).toHaveLength(2)
    expect(mockApi.list).toHaveBeenCalledOnce()
  })

  it('dedupes concurrent and repeated loads into one presets:list per session', async () => {
    // FilterToolbar, CohortFilterBar and useShortlistQuery all call loadPresets()
    // on mount; that used to be 3 identical round-trips per session.
    const a = useFilterPresetStore()
    const b = useFilterPresetStore()
    await Promise.all([a.loadPresets(), b.loadPresets()])
    await useFilterPresetStore().loadPresets()
    expect(mockApi.list).toHaveBeenCalledOnce()
    expect(a.presets.value).toHaveLength(2)
  })

  it('refetches after a mutation and after invalidation (database switch)', async () => {
    const store = useFilterPresetStore()
    await store.loadPresets()
    await store.savePreset({ name: 'Mine', filterJson: {} } as never)
    expect(mockApi.list).toHaveBeenCalledTimes(2)

    invalidateFilterPresets()
    await store.loadPresets()
    expect(mockApi.list).toHaveBeenCalledTimes(3)
  })

  it('retries on the next call when a load fails', async () => {
    mockApi.list.mockRejectedValueOnce(new Error('offline'))
    const store = useFilterPresetStore()
    await expect(store.loadPresets()).rejects.toThrow('offline')
    await store.loadPresets()
    expect(mockApi.list).toHaveBeenCalledTimes(2)
    expect(store.presets.value).toHaveLength(2)
  })

  it('visiblePresets filters by isVisible', async () => {
    mockApi.list.mockResolvedValueOnce([
      ...mockPresets,
      {
        id: 3,
        name: 'Hidden',
        filterJson: {},
        isBuiltIn: false,
        isVisible: false,
        sortOrder: 2,
        createdAt: 0,
        updatedAt: 0,
        description: null
      }
    ])
    const { visiblePresets, loadPresets } = useFilterPresetStore()
    await loadPresets()
    expect(visiblePresets.value).toHaveLength(2)
  })

  it('togglePreset adds/removes preset id from active set', async () => {
    const { activePresetIds, togglePreset, loadPresets } = useFilterPresetStore()
    await loadPresets()
    togglePreset(1)
    expect(activePresetIds.value.has(1)).toBe(true)
    togglePreset(1)
    expect(activePresetIds.value.has(1)).toBe(false)
  })

  it('getActiveFilterState merges active presets', async () => {
    const { togglePreset, getActiveFilterState, loadPresets } = useFilterPresetStore()
    await loadPresets()
    togglePreset(1) // Rare (1%)
    togglePreset(2) // HIGH Impact
    const merged = getActiveFilterState()
    expect(merged.maxGnomadAf).toBe(0.01)
    expect(merged.consequences).toEqual(['HIGH'])
  })

  it.each(['case', 'cohort'] as const)(
    'getActiveFilterState carries maxInternalAf for the %s view (last preset wins)',
    async (scope) => {
      mockApi.list.mockResolvedValueOnce([
        { ...mockPresets[0], filterJson: { maxGnomadAf: 0.01, maxInternalAf: 0.01 } },
        { ...mockPresets[1], filterJson: { consequences: ['HIGH'], maxInternalAf: 0.05 } }
      ])
      const { togglePreset, getActiveFilterState, loadPresets } = useFilterPresetStore(scope)
      await loadPresets()

      togglePreset(1)
      expect(getActiveFilterState()).toMatchObject({ maxGnomadAf: 0.01, maxInternalAf: 0.01 })

      togglePreset(2)
      expect(getActiveFilterState().maxInternalAf).toBe(0.05)

      togglePreset(1)
      togglePreset(2)
      expect(getActiveFilterState().maxInternalAf).toBeUndefined()
    }
  )

  it('keeps active presets separate for the case and cohort views (P0-3 isolation)', () => {
    const caseStore = useFilterPresetStore('case')
    const cohortStore = useFilterPresetStore('cohort')

    caseStore.togglePreset(7)

    expect(caseStore.isPresetActive(7)).toBe(true)
    expect(cohortStore.isPresetActive(7)).toBe(false)
    expect(cohortStore.activePresetIds.value.size).toBe(0)
    // The preset list itself stays shared.
    expect(cohortStore.presets).toBe(caseStore.presets)
  })
})
