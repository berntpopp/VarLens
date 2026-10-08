import type { FilterState } from '../types/filters'

export const FILTER_DEFAULTS: Readonly<FilterState> = Object.freeze({
  geneSymbol: '',
  searchQuery: '',
  consequences: [],
  funcs: [],
  clinvars: [],
  maxGnomadAf: null,
  minCadd: null,
  minCarriers: null,
  starredOnly: false,
  hasCommentOnly: false,
  acmgClassifications: [],
  tagIds: [],
  annotationScope: 'case',
  activePanelIds: [],
  panelPaddingBp: 5000,
  maxInternalAf: null,
  maxCarriers: null,
  inheritanceModes: [],
  analysisGroupId: null,
  considerPhasing: false,
  columnFilters: {}
})

export function createFilterState(overrides: Partial<FilterState> = {}): FilterState {
  const filterState: FilterState = {
    ...FILTER_DEFAULTS,
    consequences: [...FILTER_DEFAULTS.consequences],
    funcs: [...FILTER_DEFAULTS.funcs],
    clinvars: [...FILTER_DEFAULTS.clinvars],
    acmgClassifications: [...FILTER_DEFAULTS.acmgClassifications],
    tagIds: [...FILTER_DEFAULTS.tagIds],
    activePanelIds: [...FILTER_DEFAULTS.activePanelIds],
    inheritanceModes: [...FILTER_DEFAULTS.inheritanceModes],
    columnFilters: { ...FILTER_DEFAULTS.columnFilters }
  }

  if (overrides.consequences !== undefined) {
    filterState.consequences = [...overrides.consequences]
  }
  if (overrides.funcs !== undefined) {
    filterState.funcs = [...overrides.funcs]
  }
  if (overrides.clinvars !== undefined) {
    filterState.clinvars = [...overrides.clinvars]
  }
  if (overrides.acmgClassifications !== undefined) {
    filterState.acmgClassifications = [...overrides.acmgClassifications]
  }
  if (overrides.tagIds !== undefined) {
    filterState.tagIds = [...overrides.tagIds]
  }
  if (overrides.activePanelIds !== undefined) {
    filterState.activePanelIds = [...overrides.activePanelIds]
  }
  if (overrides.inheritanceModes !== undefined) {
    filterState.inheritanceModes = [...overrides.inheritanceModes]
  }
  if (overrides.columnFilters !== undefined) {
    filterState.columnFilters = { ...overrides.columnFilters }
  }

  return {
    ...filterState,
    ...overrides,
    consequences: filterState.consequences,
    funcs: filterState.funcs,
    clinvars: filterState.clinvars,
    acmgClassifications: filterState.acmgClassifications,
    tagIds: filterState.tagIds,
    activePanelIds: filterState.activePanelIds,
    inheritanceModes: filterState.inheritanceModes,
    columnFilters: filterState.columnFilters
  }
}
