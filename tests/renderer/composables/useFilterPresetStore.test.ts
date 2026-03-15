import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useFilterPresetStore } from '../../../src/renderer/src/composables/useFilterPresetStore'
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
  })

  it('loads presets on init', async () => {
    const { presets, loadPresets } = useFilterPresetStore()
    await loadPresets()
    expect(presets.value).toHaveLength(2)
    expect(mockApi.list).toHaveBeenCalledOnce()
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
})
