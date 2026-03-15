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
      <!-- Search field -->
      <v-text-field
        :model-value="searchTerm"
        variant="outlined"
        hide-details
        clearable
        placeholder="Gene, position, HGVS..."
        prepend-inner-icon="mdi-magnify"
        class="filter-search-input mr-2"
        :class="{ 'filter-active': searchTerm !== '' }"
        @update:model-value="handleSearchChange"
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
            <v-icon size="small">{{
              filters.starredOnly ? 'mdi-star' : 'mdi-star-outline'
            }}</v-icon>
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
            <v-icon size="small">{{
              filters.hasCommentOnly ? 'mdi-comment-text' : 'mdi-comment-text-outline'
            }}</v-icon>
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
import { ref, computed, watch, provide, onMounted } from 'vue'
import { useFilters } from '../../composables/useFilters'
import { useDebounce } from '../../composables/useDebounce'
import { useFilterPresetStore } from '../../composables/useFilterPresetStore'
import SlimFilterToolbar from '../SlimFilterToolbar.vue'
import ColumnsDrawer from '../ColumnsDrawer.vue'
import CohortFilterDrawer from './CohortFilterDrawer.vue'
import PresetBar from '../PresetBar.vue'
import PresetSaveDialog from '../PresetSaveDialog.vue'
import PresetManageDialog from '../PresetManageDialog.vue'
import type { ActiveFilter } from '../../../../shared/types/filters'
import type { CohortVariant } from '../../../../shared/types/cohort'
import type { CohortFilterDrawerState } from './cohortFilterDrawerTypes'
import { ACMG_FILTER_OPTIONS } from '../../utils/filters'

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
  selectedCohortFreqPreset,
  selectedAfPreset,
  selectedCaddPreset,
  customCohortFreq,
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
  loadPresets,
  togglePreset,
  isPresetActive,
  clearActivePresets,
  getActiveFilterState,
  savePreset,
  updatePreset: updatePresetStore,
  deletePreset: deletePresetStore
} = useFilterPresetStore()

// Dialog state
const showSavePresetDialog = ref(false)
const showManagePresetsDialog = ref(false)
const savingPreset = ref(false)

// Preset toggle handler — applies merged preset filters
function handlePresetToggle(presetId: number): void {
  togglePreset(presetId)
  applyActivePresets()
}

/**
 * Reset preset-managed filter fields to defaults, then re-apply
 * all currently active presets.
 */
function applyActivePresets(): void {
  filters.value.maxGnomadAf = null
  filters.value.minCadd = null
  filters.value.minCohortFrequency = null
  filters.value.minCarriers = null
  filters.value.consequences = []
  filters.value.funcs = []
  filters.value.clinvars = []
  filters.value.starredOnly = false
  filters.value.hasCommentOnly = false
  filters.value.acmgClassifications = []

  const presetState = getActiveFilterState()
  if (presetState.maxGnomadAf !== undefined) filters.value.maxGnomadAf = presetState.maxGnomadAf
  if (presetState.minCadd !== undefined) filters.value.minCadd = presetState.minCadd
  if (presetState.minCohortFrequency !== undefined)
    filters.value.minCohortFrequency = presetState.minCohortFrequency
  if (presetState.minCarriers !== undefined) filters.value.minCarriers = presetState.minCarriers
  if (presetState.consequences !== undefined) filters.value.consequences = presetState.consequences
  if (presetState.funcs !== undefined) filters.value.funcs = presetState.funcs
  if (presetState.clinvars !== undefined) filters.value.clinvars = presetState.clinvars
  if (presetState.starredOnly !== undefined) filters.value.starredOnly = presetState.starredOnly
  if (presetState.hasCommentOnly !== undefined)
    filters.value.hasCommentOnly = presetState.hasCommentOnly
  if (presetState.acmgClassifications !== undefined)
    filters.value.acmgClassifications = presetState.acmgClassifications
}

async function handleSavePreset(data: { name: string; description: string | null }): Promise<void> {
  savingPreset.value = true
  try {
    // Deep-clone via JSON to strip Vue reactive proxies for IPC serialization
    const plainFilters = JSON.parse(JSON.stringify(filters.value))
    const result = await savePreset({
      name: data.name,
      description: data.description,
      filterJson: plainFilters
    })
    // Check if IPC returned a serializable error
    if (result !== null && typeof result === 'object' && 'code' in result) {
      return
    }
    showSavePresetDialog.value = false
  } catch {
    // Save failed — dialog stays open so user can retry
  } finally {
    savingPreset.value = false
  }
}

async function handleToggleVisibility(id: number, visible: boolean): Promise<void> {
  await updatePresetStore(id, { isVisible: visible })
}

async function handleDeletePreset(id: number): Promise<void> {
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

// Cohort frequency presets
const cohortFreqPresets = [
  { label: '>=50%', value: 0.5 },
  { label: '>=25%', value: 0.25 },
  { label: '>=10%', value: 0.1 }
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

// Merged has-active check (includes column filters)
const mergedHasActiveFilters = computed(
  () => hasActiveFilters.value || (props.columnActiveFilters ?? []).length > 0
)

// Filter count only reflects actual filters, not sort
const activeFilterCount = computed(() => mergedActiveFilters.value.length)

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
    case 'cohort-freq':
    case 'cohortFreq':
      return (
        filters.value.minCohortFrequency !== null &&
        !Number.isNaN(filters.value.minCohortFrequency) &&
        filters.value.minCohortFrequency > 0
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

  // eslint-disable-next-line no-undef, @typescript-eslint/no-explicit-any
  if (typeof window === 'undefined' || typeof (window as any).api === 'undefined') {
    return
  }

  loadingGeneSuggestions.value = true
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-undef
    const result = await (window as any).api.cohort.getVariants({
      gene_symbol: query,
      limit: 100
    })

    if (result !== null && result !== undefined && 'code' in result) {
      geneSymbolSuggestions.value = []
      return
    }

    const variants: CohortVariant[] = result?.data ?? []
    geneSymbolSuggestions.value = [
      ...new Set(variants.map((v) => v.gene_symbol).filter((s): s is string => s !== null))
    ]
  } catch {
    geneSymbolSuggestions.value = []
  } finally {
    loadingGeneSuggestions.value = false
  }
}

// Provide shared filter state for CohortFilterDrawer (via provide/inject)
provide<CohortFilterDrawerState>('cohortFilterDrawerState', {
  filters,
  searchTerm,
  selectedImpactPresets,
  selectedCohortFreqPreset,
  selectedAfPreset,
  selectedCaddPreset,
  customCohortFreq,
  customGnomadAf,
  customCadd,
  geneSymbolSuggestions,
  loadingGeneSuggestions,
  impactPresets,
  cohortFreqPresets,
  afPresets,
  caddPresets,
  acmgFilterOptions,
  hasActiveFilters,
  activeFilterCount,
  activeFiltersList,
  isFilterGroupActive,
  clearAllFilters,
  clearFilter,
  searchGeneSymbols
})

// Debounced filter change emission
const { debouncedFn: emitFilterChange } = useDebounce(() => emit('filter-change'), 300)

// Watch filter state changes
watch(filters, () => emitFilterChange(), { deep: true })
watch(selectedImpactPresets, () => emitFilterChange())
watch([selectedCohortFreqPreset, selectedAfPreset, selectedCaddPreset], () => emitFilterChange())

const handleSearchChange = (value: string | null) => {
  searchTerm.value = value ?? ''
  emitFilterChange()
}

const handleClearAll = () => {
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

// Load presets on mount
onMounted(async () => {
  await loadPresets()
})
</script>

<style scoped>
.filter-search-input {
  max-width: 240px;
  flex-shrink: 1;
}

.filter-search-input :deep(.v-field) {
  border-radius: 6px;
  border-color: rgba(0, 0, 0, 0.15);
}

.filter-search-input :deep(.v-field--focused) {
  box-shadow: 0 0 0 2px color-mix(in srgb, rgb(var(--v-theme-primary)) 15%, transparent);
}

.filter-search-input :deep(.v-field__input) {
  font-size: 0.85rem;
}

.filter-search-input.filter-active :deep(.v-field) {
  border-color: rgb(var(--v-theme-primary));
  border-width: 2px;
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 4%, transparent);
}
</style>
