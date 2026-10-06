<template>
  <SlimFilterToolbar
    :filtered-count="totalCount ?? 0"
    :total-count="cohortSummary?.unique_variants ?? null"
    :has-active-filters="mergedHasActiveFilters"
    :has-clearable-state="props.hasSort"
    :active-filter-count="activeFilterCount"
    :active-filters-list="mergedActiveFilters"
    :exporting="exporting"
    :columns="columns"
    @clear-all="handleClearAll"
    @clear-filter="handleClearFilter"
    @open-filter-drawer="filterDrawerOpen = true"
    @open-columns-drawer="columnsDrawerOpen = true"
    @export="handleExport"
  >
    <template #filters>
      <!-- DSL search bar (same component as variant table) -->
      <DslSearchBar
        :raw-input="dslInput"
        :suggestions="dslSuggestions"
        :is-dsl-mode="isDslMode"
        :errors="dslErrors"
        class="filter-search-input mr-2"
        @update:raw-input="dslInput = $event"
        @apply="applyDslFilters"
        @clear="handleDslClear"
        @select-suggestion="applySuggestion"
      />

      <!-- Star toggle -->
      <v-tooltip location="bottom">
        <template #activator="{ props: tooltipProps }">
          <v-btn
            v-bind="tooltipProps"
            :color="filters.starredOnly ? 'amber-darken-2' : undefined"
            :variant="filters.starredOnly ? 'flat' : 'text'"
            density="compact"
            icon
            @click="filters.starredOnly = !filters.starredOnly"
          >
            <v-icon size="small" :icon="filters.starredOnly ? mdiStar : mdiStarOutline" />
          </v-btn>
        </template>
        {{
          filters.starredOnly
            ? 'Showing starred only \u2014 click to clear'
            : 'Show starred variants only'
        }}
      </v-tooltip>

      <!-- Comment toggle -->
      <v-tooltip location="bottom">
        <template #activator="{ props: tooltipProps }">
          <v-btn
            v-bind="tooltipProps"
            :color="filters.hasCommentOnly ? 'primary' : undefined"
            :variant="filters.hasCommentOnly ? 'flat' : 'text'"
            density="compact"
            icon
            @click="filters.hasCommentOnly = !filters.hasCommentOnly"
          >
            <v-icon
              size="small"
              :icon="filters.hasCommentOnly ? mdiCommentText : mdiCommentTextOutline"
            />
          </v-btn>
        </template>
        {{
          filters.hasCommentOnly
            ? 'Showing commented only \u2014 click to clear'
            : 'Show variants with comments only'
        }}
      </v-tooltip>

      <!-- ACMG classification chips -->
      <v-chip-group v-model="filters.acmgClassifications" multiple class="flex-nowrap">
        <v-chip
          v-for="cls in acmgFilterOptions"
          :key="cls.value"
          :value="cls.value"
          :color="cls.color"
          filter
          variant="outlined"
          size="small"
        >
          {{ cls.label }}
        </v-chip>
      </v-chip-group>

      <!-- Extension column filter narrowing chip (SV only / CNV only / STR only) -->
      <FilterTypeNarrowingChip
        :column-filters="filters.columnFilters"
        @clear-filter="handleClearTypeFilter"
      />

      <!-- Impact preset chips moved to filter drawer only -->
    </template>

    <template #preset-bar>
      <PresetBar
        :visible-presets="visiblePresets"
        :is-preset-active="isPresetActive"
        :has-active-filters="mergedHasActiveFilters"
        @toggle="handlePresetToggle"
        @save="showSavePresetDialog = true"
        @manage="showManagePresetsDialog = true"
      />
    </template>

    <template #drawers>
      <ColumnsDrawer
        v-if="columns && columns.length > 0"
        v-model:open="columnsDrawerOpen"
        :columns="columns"
        :visible-columns="visibleColumns"
        table-id="cohort-table"
        @toggle:column="handleToggleColumn"
        @reorder="handleReorderColumns"
        @reset="handleResetColumns"
      />
      <CohortFilterDrawer v-model:open="filterDrawerOpen" />
      <PresetSaveDialog
        v-model="showSavePresetDialog"
        :saving="savingPreset"
        @save="handleSavePreset"
      />
      <PresetManageDialog
        v-model="showManagePresetsDialog"
        :presets="allPresets"
        @toggle-visibility="handleToggleVisibility"
        @delete="handleDeletePreset"
      />
    </template>
  </SlimFilterToolbar>
</template>

<script setup lang="ts">
import { ref, computed, watch, provide, onMounted, nextTick } from 'vue'
import { useFilters } from '../../composables/useFilters'
import { useDebounce } from '../../composables/useDebounce'
import { useFilterPresetStore } from '../../composables/useFilterPresetStore'
import SlimFilterToolbar from '../SlimFilterToolbar.vue'
import DslSearchBar from '../DslSearchBar.vue'
import { useDslFilterIntegration } from '../../composables/useDslFilterIntegration'
import ColumnsDrawer from '../ColumnsDrawer.vue'
import CohortFilterDrawer from './CohortFilterDrawer.vue'
import PresetBar from '../PresetBar.vue'
import PresetSaveDialog from '../PresetSaveDialog.vue'
import PresetManageDialog from '../PresetManageDialog.vue'
import type { ActiveFilter } from '../../../../shared/types/filters'
import type { CohortVariant } from '../../../../shared/types/cohort'
import type { ColumnFiltersParam } from '../../../../shared/types/column-filters'
import type { CohortFilterDrawerState } from './cohortFilterDrawerTypes'
import FilterTypeNarrowingChip from '../filters/FilterTypeNarrowingChip.vue'
import { mdiCommentText, mdiCommentTextOutline, mdiStar, mdiStarOutline } from '@mdi/js'
import {
  ACMG_FILTER_OPTIONS,
  applyPresetStateToFilters,
  isPresetDiverged
} from '../../utils/filters'
import { stripVueProxies } from '../../utils/stripVueProxies'
import { logService } from '../../services/LogService'
import { isIpcError, unwrapIpcResult } from '../../../../shared/types/errors'
import { useApiService } from '../../composables/useApiService'
import { getCurrentUnsupportedReason, type CapabilityPath } from '../../utils/backend-capabilities'

interface Props {
  totalCount: number | null
  cohortSummary: { total_cases: number; unique_variants: number } | null
  columns: Array<{ key: string; title: string }>
  visibleColumns: string[]
  exporting: boolean
  hasSort?: boolean
  /** Per-column active filter chips from CohortDataTable */
  columnActiveFilters?: ActiveFilter[]
}

const props = defineProps<Props>()

const { api } = useApiService()

function warnUnsupported(reason: string): void {
  logService.warn(reason, 'backend-capabilities')
}

async function canUseOrWarn(path: CapabilityPath): Promise<boolean> {
  const reason = await getCurrentUnsupportedReason(path)
  if (reason !== null) {
    warnUnsupported(reason)
    return false
  }
  return true
}

const emit = defineEmits<{
  'filter-change': []
  'clear-all': []
  'clear-filter': [filterId: string]
  'clear-column-filter': [columnKey: string]
  'clear-column-filters': []
  export: []
  'toggle-column': [key: string]
  'reorder-columns': [keys: string[]]
  'reset-columns': []
}>()

// Access filter state from composable
const {
  filters,
  searchTerm,
  selectedImpactPresets,
  selectedAfPreset,
  selectedCaddPreset,
  customGnomadAf,
  customCadd,
  hasActiveFilters,
  activeFiltersList,
  clearAllFilters,
  clearFilter
} = useFilters()

// Preset store
const {
  presets: allPresets,
  visiblePresets,
  activePresetIds,
  loadPresets,
  togglePreset,
  isPresetActive,
  clearActivePresets,
  getActiveFilterState,
  savePreset,
  updatePreset: updatePresetStore,
  deletePreset: deletePresetStore
} = useFilterPresetStore('cohort')

// Dialog state
const showSavePresetDialog = ref(false)
const showManagePresetsDialog = ref(false)
const savingPreset = ref(false)
let applyingPresets = false

// Preset toggle handler — applies merged preset filters
async function handlePresetToggle(presetId: number): Promise<void> {
  if (!(await canUseOrWarn('workflow.filterPresets'))) return
  togglePreset(presetId)
  applyActivePresets()
}

/**
 * Reset preset-managed filter fields to defaults, then re-apply
 * all currently active presets. Routes consequences to selectedImpactPresets
 * because the cohort query reads from that ref, not filters.consequences.
 */
function applyActivePresets(): void {
  applyingPresets = true
  applyPresetStateToFilters({
    filters,
    presetState: getActiveFilterState(),
    consequencesTarget: selectedImpactPresets,
    includeCohortFields: true
  })
  void nextTick(() => {
    applyingPresets = false
  })
}

// Auto-deactivate presets when user manually changes filter values
const presetDivergenceKey = computed(() =>
  JSON.stringify([filters.value, selectedImpactPresets.value])
)
watch(presetDivergenceKey, () => {
  if (applyingPresets || activePresetIds.value.size === 0) return
  const idsToDeactivate: number[] = []
  for (const id of activePresetIds.value) {
    const preset = allPresets.value.find((p) => p.id === id)
    if (
      preset !== undefined &&
      isPresetDiverged({
        filters: filters.value,
        presetFilterJson: preset.filterJson,
        consequencesValue: selectedImpactPresets.value
      })
    ) {
      idsToDeactivate.push(id)
    }
  }
  for (const id of idsToDeactivate) {
    togglePreset(id)
  }
})

async function handleSavePreset(data: { name: string; description: string | null }): Promise<void> {
  if (!(await canUseOrWarn('workflow.filterPresets'))) return
  savingPreset.value = true
  try {
    const plainFilters = stripVueProxies(filters.value)
    await savePreset({
      name: data.name,
      description: data.description,
      filterJson: plainFilters
    })
    showSavePresetDialog.value = false
  } catch (e) {
    logService.warn(
      'Failed to save cohort filter preset: ' + (e instanceof Error ? e.message : String(e)),
      'filters'
    )
  } finally {
    savingPreset.value = false
  }
}

async function handleToggleVisibility(id: number, visible: boolean): Promise<void> {
  if (!(await canUseOrWarn('workflow.filterPresets'))) return
  await updatePresetStore(id, { isVisible: visible })
}

async function handleDeletePreset(id: number): Promise<void> {
  if (!(await canUseOrWarn('workflow.filterPresets'))) return
  await deletePresetStore(id)
}

// Drawer state
const columnsDrawerOpen = ref(false)
const filterDrawerOpen = ref(false)

// ACMG filter options (shared constant)
const acmgFilterOptions = ACMG_FILTER_OPTIONS

// Impact presets
const impactPresets = [
  { label: 'HIGH', value: 'HIGH', color: 'error' },
  { label: 'MOD', value: 'MODERATE', color: 'warning' },
  { label: 'LOW', value: 'LOW', color: 'info' }
]

// gnomAD AF presets
const afPresets = [
  { label: '1%', value: 0.01 },
  { label: '0.1%', value: 0.001 },
  { label: '0.01%', value: 0.0001 }
]

// CADD presets
const caddPresets = [
  { label: '15', value: 15 },
  { label: '20', value: 20 },
  { label: '25', value: 25 }
]

// Merged active filters: regular filters + column filters
const mergedActiveFilters = computed<ActiveFilter[]>(() => [
  ...activeFiltersList.value,
  ...(props.columnActiveFilters ?? [])
])

// Merged has-active check (includes column filters + DSL filters)
const mergedHasActiveFilters = computed(
  () =>
    hasActiveFilters.value || (props.columnActiveFilters ?? []).length > 0 || hasDslFilters.value
)

// Filter count reflects actual filters + DSL column filters, not sort
const activeFilterCount = computed(
  () => mergedActiveFilters.value.length + Object.keys(dslColumnFilters.value).length
)

// Gene autocomplete state
const geneSymbolSuggestions = ref<string[]>([])
const loadingGeneSuggestions = ref(false)

/**
 * Check whether a specific filter group has active filters.
 */
const isFilterGroupActive = (groupId: string): boolean => {
  switch (groupId) {
    case 'search':
      return searchTerm.value !== ''
    case 'gene':
      return filters.value.geneSymbol !== ''
    case 'impact':
      return selectedImpactPresets.value.length > 0
    case 'function':
      return filters.value.funcs.length > 0
    case 'clinvar':
      return filters.value.clinvars.length > 0
    case 'internal-frequency':
      return (
        filters.value.maxInternalAf !== null &&
        !Number.isNaN(filters.value.maxInternalAf) &&
        filters.value.maxInternalAf > 0
      )
    case 'frequency':
      return (
        filters.value.maxGnomadAf !== null &&
        !Number.isNaN(filters.value.maxGnomadAf) &&
        filters.value.maxGnomadAf > 0
      )
    case 'cadd':
      return (
        filters.value.minCadd !== null &&
        !Number.isNaN(filters.value.minCadd) &&
        filters.value.minCadd >= 0
      )
    case 'starred':
      return filters.value.starredOnly
    case 'comments':
      return filters.value.hasCommentOnly
    case 'acmg':
      return filters.value.acmgClassifications.length > 0
    case 'annotations':
      return (
        filters.value.starredOnly ||
        filters.value.hasCommentOnly ||
        filters.value.acmgClassifications.length > 0
      )
    default:
      return false
  }
}

/**
 * Search gene symbols for autocomplete suggestions
 */
const searchGeneSymbols = async (query: string) => {
  if (!query || query.length < 2) {
    geneSymbolSuggestions.value = []
    return
  }

  if (api == null) return

  if (!(await canUseOrWarn('cohort.query'))) {
    geneSymbolSuggestions.value = []
    return
  }

  loadingGeneSuggestions.value = true
  try {
    const result = unwrapIpcResult(
      await api.cohort.getVariants({
        gene_symbol: query,
        limit: 100
      })
    )

    const variants: CohortVariant[] = result?.data ?? []
    geneSymbolSuggestions.value = [
      ...new Set(variants.map((v) => v.gene_symbol).filter((s): s is string => s !== null))
    ]
  } catch (e) {
    logService.warn(
      'Gene symbol autocomplete failed: ' + (e instanceof Error ? e.message : String(e)),
      'filters'
    )
    geneSymbolSuggestions.value = []
  } finally {
    loadingGeneSuggestions.value = false
  }
}

// One shared debouncer: search + drawer edits in the same window coalesce.
const { debouncedFn: emitFilterChange } = useDebounce(() => emit('filter-change'), 250)

// Watch filter state changes (searchTerm lives outside `filters` — P0-4)
const cohortFilterKey = computed(() => JSON.stringify(filters.value))
watch([cohortFilterKey, searchTerm], () => emitFilterChange())
watch(selectedImpactPresets, () => emitFilterChange())
watch([selectedAfPreset, selectedCaddPreset], () => emitFilterChange())

// DSL search integration — same composable as variant table (DRY)
const {
  dslInput,
  dslSuggestions,
  isDslMode,
  dslErrors,
  dslColumnFilters,
  hasDslFilters,
  applyDslFilters,
  handleDslClear,
  applySuggestion
} = useDslFilterIntegration({
  presetNames: () => allPresets.value.map((p) => p.name.toLowerCase().replace(/\s+/g, '_')),
  searchQueryRef: searchTerm,
  emitFilters: emitFilterChange,
  clearConflictingDrawerFields: (columnFilters) => {
    if ('gnomad_af' in columnFilters) filters.value.maxGnomadAf = null
    if ('cadd' in columnFilters) filters.value.minCadd = null
  }
})

/**
 * Clear all extension column filters for a given variant type (sv/cnv/str).
 * Strips every key matching `${typeKey}.*` from filters.columnFilters so the
 * cohort query drops the corresponding WHERE clauses on next emission.
 */
function handleClearTypeFilter(typeKey: string): void {
  const next: ColumnFiltersParam = { ...filters.value.columnFilters }
  for (const key of Object.keys(next)) {
    if (key.startsWith(`${typeKey}.`)) {
      delete next[key]
    }
  }
  filters.value.columnFilters = next
}

// Reactive list of all case IDs in the database — used as the scope for
// extension column metadata and type-presence queries in the cohort drawer.
// Loaded on mount via loadCohortCaseIds() in onMounted.
const cohortCaseIds = ref<number[]>([])

async function loadCohortCaseIds(): Promise<void> {
  if (api == null) return
  try {
    const caseList = unwrapIpcResult(await api.cases.list())
    cohortCaseIds.value = caseList.map((c) => c.id)
  } catch (e) {
    logService.warn(
      'Failed to load cohort case IDs: ' +
        (e instanceof Error ? e.message : isIpcError(e) ? (e.userMessage ?? e.message) : String(e)),
      'filters'
    )
    cohortCaseIds.value = []
  }
}

// Provide shared filter state for CohortFilterDrawer (via provide/inject)
provide<CohortFilterDrawerState>('cohortFilterDrawerState', {
  filters,
  searchTerm,
  selectedImpactPresets,
  selectedAfPreset,
  selectedCaddPreset,
  customGnomadAf,
  customCadd,
  geneSymbolSuggestions,
  loadingGeneSuggestions,
  impactPresets,
  afPresets,
  caddPresets,
  acmgFilterOptions,
  hasActiveFilters,
  activeFilterCount,
  activeFiltersList,
  isFilterGroupActive,
  clearAllFilters,
  clearFilter,
  searchGeneSymbols,

  // Preset store integration
  visiblePresets,
  isPresetActive,
  onPresetToggle: handlePresetToggle,
  onPresetSave: () => {
    showSavePresetDialog.value = true
  },
  onPresetManage: () => {
    showManagePresetsDialog.value = true
  },
  hasActiveFiltersForSave: mergedHasActiveFilters,

  // DSL search state
  dslInput,
  dslSuggestions,
  isDslMode,
  dslErrors,
  onDslApply: applyDslFilters,
  onDslClear: handleDslClear,
  onDslSuggestionSelect: applySuggestion,
  dslColumnFilters,

  // Extension column filters (Task 12) — cohort scope spans all loaded cases.
  // The drawer reads via `columnFilters.value` and writes via
  // `onColumnFiltersUpdate`, so a read-only computed ref is sufficient.
  columnFilters: computed(() => filters.value.columnFilters),
  cohortCaseIds,
  onColumnFiltersUpdate: (value) => {
    filters.value.columnFilters = value
  },
  onClearTypeFilter: handleClearTypeFilter
})

const handleClearAll = () => {
  handleDslClear() // Must be first — clears dslColumnFilters before filter watchers fire
  clearAllFilters()
  clearActivePresets()
  emit('clear-column-filters')
  emit('clear-all')
}

const handleClearFilter = (filterId: string) => {
  if (filterId.startsWith('col:')) {
    const columnKey = filterId.slice(4)
    emit('clear-column-filter', columnKey)
  } else {
    clearFilter(filterId)
    emit('clear-filter', filterId)
  }
}

const handleToggleColumn = (key: string) => {
  emit('toggle-column', key)
}

const handleReorderColumns = (keys: string[]) => {
  emit('reorder-columns', keys)
}

const handleResetColumns = () => {
  emit('reset-columns')
}

const handleExport = () => {
  emit('export')
}

// Load presets + cohort case IDs on mount
onMounted(async () => {
  const presetReason = await getCurrentUnsupportedReason('workflow.filterPresets')
  if (presetReason !== null) {
    warnUnsupported(presetReason)
    await loadCohortCaseIds()
    return
  }

  await Promise.all([loadPresets(), loadCohortCaseIds()])
})

// Expose DSL column filters for CohortTable to merge into query
defineExpose({ dslColumnFilters })
</script>

<style scoped>
.filter-search-input {
  min-width: 180px;
  max-width: 320px;
  flex-shrink: 1;
  flex-grow: 1;
}
</style>
