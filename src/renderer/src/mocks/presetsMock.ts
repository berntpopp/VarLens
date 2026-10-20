import type { PresetsAPI } from '../../../shared/types/api'
import type { FilterPreset } from '../../../shared/types/filter-presets'
import { BUILT_IN_SHORTLIST_PRESETS } from '../../../shared/config/built-in-shortlist-presets'

export const defaultMockShortlistPresets: FilterPreset[] = BUILT_IN_SHORTLIST_PRESETS.map(
  (preset, index) => ({
    id: index + 1,
    name: preset.name,
    description: preset.description,
    filterJson: { shortlist: preset.config },
    kind: 'shortlist',
    isBuiltIn: true,
    isVisible: true,
    sortOrder: preset.sortOrder,
    createdAt: 0,
    updatedAt: 0
  })
)

const clonePresets = (): FilterPreset[] =>
  defaultMockShortlistPresets.map((p) => ({
    ...p,
    filterJson: structuredClone(p.filterJson)
  }))

let mockPresets: FilterPreset[] = clonePresets()

export function resetMockPresets(): void {
  mockPresets = clonePresets()
}

export const mockPresetsApi: PresetsAPI = {
  list: async () => [...mockPresets],
  create: async (params) => {
    const p: FilterPreset = {
      id: (mockPresets.length > 0 ? Math.max(...mockPresets.map((x) => x.id)) : 0) + 1,
      name: params.name,
      description: params.description ?? null,
      filterJson: params.filterJson,
      kind: params.kind ?? 'filter',
      isBuiltIn: false,
      isVisible: true,
      sortOrder: mockPresets.length,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    mockPresets.push(p)
    return p
  },
  update: async (_id, updates) => {
    const idx = mockPresets.findIndex((p) => p.id === _id)
    if (idx !== -1) {
      mockPresets[idx] = { ...mockPresets[idx], ...updates, updatedAt: Date.now() }
      return mockPresets[idx]
    }
    return {
      id: _id,
      name: updates.name ?? 'Preset',
      description: updates.description ?? null,
      filterJson: updates.filterJson ?? {},
      kind: updates.kind ?? 'filter',
      isBuiltIn: false,
      isVisible: updates.isVisible ?? true,
      sortOrder: updates.sortOrder ?? 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  },
  delete: async (id) => {
    mockPresets = mockPresets.filter((p) => p.id !== id)
  },
  reorder: async (items) => {
    for (const item of items) {
      const p = mockPresets.find((x) => x.id === item.id)
      if (p) p.sortOrder = item.sortOrder
    }
  }
}
