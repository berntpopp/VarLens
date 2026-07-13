<template>
  <SlimFilterToolbar
    :filtered-count="filteredCount"
    :total-count="totalCount"
    :has-active-filters="mergedHasActiveFilters"
    :has-clearable-state="props.hasSort"
    :active-filter-count="mergedActiveFilterCount"
    :active-filters-list="mergedActiveFiltersList"
    :exporting="exporting"
    :columns="columns"
    @clear-all="handleClearAll"
    @clear-filter="handleClearFilter"
    @open-filter-drawer="filterDrawerOpen = true"
    @open-columns-drawer="columnsDrawerOpen = true"
    @export="exportToExcel"
  >
    <template #filters>
      <!-- DSL search bar (replaces plain text search) -->
      <DslSearchBar
        ref="searchFieldRef"
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
            @click="toggleStarred"
          >
            <v-icon size="small" :icon="filters.starredOnly ? mdiStar : mdiStarOutline" />
          </v-btn>
        </template>
        {{
          filters.starredOnly
            ? 'Showing starred only — click to clear'
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
            @click="toggleCommented"
          >
            <v-icon
              size="small"
              :icon="filters.hasCommentOnly ? mdiCommentText : mdiCommentTextOutline"
            />
          </v-btn>
        </template>
        {{
          filters.hasCommentOnly
            ? 'Showing commented only — click to clear'
            : 'Show variants with comments only'
        }}
      </v-tooltip>

      <!-- ACMG classification chips (hidden at narrow widths, available in drawer) -->
      <v-chip-group
        v-if="showToolbarAcmg && canUseAcmgFilters"
        v-model="filters.acmgClassifications"
        multiple
        class="ml-2 flex-nowrap"
      >
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

    <template #hints>
      <v-expand-transition>
        <div
          v-if="(filters.starredOnly || filters.hasCommentOnly) && filteredCount === 0"
          class="annotation-hint-bar"
        >
          <v-icon size="small" class="mr-1" :icon="mdiInformationOutline" />
          <span class="text-body-small">
            {{
              filters.annotationScope === 'all'
                ? 'No variants match the annotation filter. This includes global annotations from other cases.'
                : 'No variants match the annotation filter. Star or comment on variants first, then filter.'
            }}
          </span>
        </div>
      </v-expand-transition>
    </template>

    <template #drawers>
      <FilterDrawer v-model:open="filterDrawerOpen" />
      <ColumnsDrawer
        v-if="columns && columns.length > 0"
        v-model:open="columnsDrawerOpen"
        :columns="orderedColumns"
        :visible-columns="visibleColumnKeys"
        table-id="variant-table"
        @toggle:column="toggleColumnVisibility"
        @reorder="setColumnOrder"
        @reset="resetColumnDefaults"
      />
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
import { ref, computed, watch, onMounted, provide, nextTick, toRaw } from 'vue'
import { logService } from '../services/LogService'
import { useFilterState } from '../composables/useFilterState'
import { useColumnPreferences } from '../composables/useColumnPreferences'
import { useFilterPresetStore } from '../composables/useFilterPresetStore'
import { useDslFilterIntegration } from '../composables/useDslFilterIntegration'
import SlimFilterToolbar from './SlimFilterToolbar.vue'
import DslSearchBar from './DslSearchBar.vue'
import ColumnsDrawer from './ColumnsDrawer.vue'
import FilterDrawer from './FilterDrawer.vue'
import PresetBar from './PresetBar.vue'
import PresetSaveDialog from './PresetSaveDialog.vue'
import PresetManageDialog from './PresetManageDialog.vue'
import FilterTypeNarrowingChip from './filters/FilterTypeNarrowingChip.vue'
import type { VariantFilter } from '../../../shared/types/api'
import type { ColumnFilter, ColumnFiltersParam } from '../../../shared/types/column-filters'
import type { ActiveFilter } from '../../../shared/types/filters'
import type { FilterDrawerState } from './filterDrawerTypes'
import { ACMG_FILTER_OPTIONS, applyPresetStateToFilters, isPresetDiverged } from '../utils/filters'
import { stripVueProxies } from '../utils/stripVueProxies'
import { useResponsiveLayout } from '../composables/useResponsiveLayout'
import { useApiService } from '../composables/useApiService'
import {
  currentCanUseFeature,
  getCurrentUnsupportedReason,
  type CapabilityPath
} from '../utils/backend-capabilities'
import {
  mdiCommentText,
  mdiCommentTextOutline,
  mdiInformationOutline,
  mdiStar,
  mdiStarOutline
} from '@mdi/js'

interface ColumnDef {
  key: string
  title: string
}

interface Props {
  caseId: number
  caseName: string
  filteredCount: number
  totalCount: number
  hasSort?: boolean
  initialSearch?: string
  columns?: ColumnDef[]
  /** Additional active filter chips from column filters (appended to drawer filter chips) */
  columnActiveFilters?: ActiveFilter[]
}

const props = defineProps<Props>()

interface Emits {
  (e: 'update:filters', filters: Omit<VariantFilter, 'case_id'>): void
  (e: 'reset-sort'): void
  (e: 'clear-column-filters'): void
  (e: 'clear-column-filter', columnKey: string): void
  (
    e: 'export-success',
    data: { filePath: string; action: { text: string; callback: () => void } }
  ): void
  (e: 'export-error', error: string): void
}

const emit = defineEmits<Emits>()

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

function sanitizeUnsupportedVariantFilters(
  filter: Omit<VariantFilter, 'case_id'>
): Omit<VariantFilter, 'case_id'> {
  const next: Omit<VariantFilter, 'case_id'> = { ...filter }

  if (!currentCanUseFeature('variants.tagFilters')) {
    delete next.tag_ids
  }
  if (!currentCanUseFeature('variants.commentFilters')) {
    delete next.has_comment
  }
  if (!currentCanUseFeature('variants.acmgFilters')) {
    delete next.acmg_classifications
  }
  if (!currentCanUseFeature('variants.annotationFilters')) {
    delete next.annotation_scope
    delete next.starred_only
  }
  if (!currentCanUseFeature('variants.panelFilters')) {
    delete next.active_panel_ids
    delete next.panel_padding_bp
    delete next.panel_intervals
  }
  if (!currentCanUseFeature('variants.columnMeta')) {
    delete next.column_filters
  }
  if (!currentCanUseFeature('variants.inheritanceFilters')) {
    delete next.inheritance_modes
  }
  if (!currentCanUseFeature('variants.analysisGroupFilters')) {
    delete next.analysis_group_id
  }
  if (!currentCanUseFeature('variants.phasingFilters')) {
    delete next.consider_phasing
  }

  return next
}

// Forward ref for DSL column filters — populated by useDslFilterIntegration below.
// Used in onFiltersUpdate closure to merge DSL column filters into the emitted payload.
const dslColumnFiltersRef = ref<Record<string, ColumnFilter>>({})

// Filter state composable - single source of truth for all filter logic
const {
  filters,
  filterOptions,
  geneSymbolSuggestions,
  loadingSuggestions,
  selectedImpactPresets,
  selectedAfPreset,
  selectedCaddPreset,
  exporting,
  afPresets,
  caddPresets,
  impactPresets,
  availableTags,
  hasActiveFilters,
  activeFilterCount,
  activeFiltersList,
  isFilterGroupActive,
  clearFilter,
  removeTagFilter,
  clearAllFilters,
  handleGeneClear,
  searchGeneSymbols,
  loadFilterOptions,
  setInitialSearch,
  emitFilters,
  exportToExcel: composableExportToExcel
} = useFilterState(
  computed(() => props.caseId),
  {
    onFiltersUpdate: (f) => {
      // Merge DSL column filters + shared FilterState.columnFilters into the
      // outgoing payload. Order of precedence (later overrides earlier):
      //   1. f.column_filters (from buildFilterFromState — currently unused)
      //   2. filters.value.columnFilters (ExtensionColumnFilters UI)
      //   3. dslColumnFiltersRef.value (DSL search bar)
      // dslIntegration is initialized after this but the closure captures the
      // ref which is populated later.
      const stateColumnFilters = filters.value.columnFilters
      const hasDslFilters = Object.keys(dslColumnFiltersRef.value).length > 0
      const hasStateFilters =
        stateColumnFilters !== undefined && Object.keys(stateColumnFilters).length > 0
      if (hasDslFilters || hasStateFilters) {
        emit(
          'update:filters',
          sanitizeUnsupportedVariantFilters({
            ...f,
            column_filters: {
              ...(f.column_filters ?? {}),
              ...(stateColumnFilters ?? {}),
              ...dslColumnFiltersRef.value
            }
          })
        )
      } else {
        emit('update:filters', sanitizeUnsupportedVariantFilters(f))
      }
    },
    onResetSort: () => emit('reset-sort'),
    onCaseSwitch: () => {
      // Clear DSL column filters and active presets when switching cases
      handleDslClear()
      clearActivePresets()
      emit('clear-column-filters')
    }
  }
)

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
} = useFilterPresetStore()

// DSL search integration — shared composable for all filter toolbars
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
  columnFiltersRef: dslColumnFiltersRef,
  presetNames: () => allPresets.value.map((p) => p.name.toLowerCase().replace(/\s+/g, '_')),
  searchQueryRef: computed({
    get: () => filters.value.searchQuery,
    set: (v) => {
      filters.value.searchQuery = v
    }
  }),
  emitFilters,
  clearConflictingDrawerFields: (columnFilters) => {
    if ('gnomad_af' in columnFilters) filters.value.maxGnomadAf = null
    if ('cadd' in columnFilters) filters.value.minCadd = null
  },
  resolvePreset: (presetName) => {
    const preset = allPresets.value.find(
      (p) => p.name.toLowerCase().replace(/\s+/g, '_') === presetName
    )
    if (preset && !isPresetActive(preset.id)) {
      handlePresetToggle(preset.id)
    }
  }
})

// Dialog state
const showSavePresetDialog = ref(false)
const showManagePresetsDialog = ref(false)
const savingPreset = ref(false)
let applyingPresets = false // guard to skip divergence check during applyActivePresets

// Preset toggle handler — applies merged preset filters
async function handlePresetToggle(presetId: number): Promise<void> {
  if (!(await canUseOrWarn('workflow.filterPresets'))) return
  togglePreset(presetId)
  applyActivePresets()
}

/**
 * Reset preset-managed filter fields to defaults, then re-apply
 * all currently active presets. This ensures toggling OFF a preset
 * properly clears its contributed values.
 */
function applyActivePresets(): void {
  applyingPresets = true
  applyPresetStateToFilters({
    filters,
    presetState: getActiveFilterState()
  })
  // Reset guard after Vue reactivity settles
  void nextTick(() => {
    applyingPresets = false
  })
}

// Auto-deactivate presets when user manually changes filter values
// Serialized key avoids deep reactive traversal — only fires when
// actual filter values change, not on every nested property access
const presetDivergenceKey = computed(() => JSON.stringify(toRaw(filters.value)))
watch(presetDivergenceKey, () => {
  if (applyingPresets || activePresetIds.value.size === 0) return
  const idsToDeactivate: number[] = []
  for (const id of activePresetIds.value) {
    const preset = allPresets.value.find((p) => p.id === id)
    if (
      preset !== undefined &&
      isPresetDiverged({ filters: filters.value, presetFilterJson: preset.filterJson })
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
      'Failed to save filter preset: ' + (e instanceof Error ? e.message : String(e)),
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

// Toggle methods for star/comment
const toggleStarred = async () => {
  if (!(await canUseOrWarn('variants.annotationFilters'))) return
  filters.value.starredOnly = !filters.value.starredOnly
}
const toggleCommented = async () => {
  if (!(await canUseOrWarn('variants.commentFilters'))) return
  filters.value.hasCommentOnly = !filters.value.hasCommentOnly
}

// ACMG classification options (shared constant)
const acmgFilterOptions = ACMG_FILTER_OPTIONS

// Responsive layout — hide ACMG chips at compact/narrow widths (available in drawer)
const { tier } = useResponsiveLayout()
const showToolbarAcmg = computed(() => tier.value === 'full')
const canUseAcmgFilters = computed(() => currentCanUseFeature('variants.acmgFilters'))

// Drawer states with mutual exclusion
const filterDrawerOpen = ref(false)
const columnsDrawerOpen = ref(false)

// Ensure only one drawer is open at a time
watch(filterDrawerOpen, (isOpen) => {
  if (isOpen) columnsDrawerOpen.value = false
})
watch(columnsDrawerOpen, (isOpen) => {
  if (isOpen) filterDrawerOpen.value = false
})

// Provide shared filter state for FilterDrawer (via provide/inject)
provide<FilterDrawerState>('filterDrawerState', {
  filters,
  filterOptions,
  geneSymbolSuggestions,
  loadingSuggestions,
  selectedImpactPresets,
  selectedAfPreset,
  selectedCaddPreset,
  afPresets,
  caddPresets,
  impactPresets,
  availableTags,
  hasActiveFilters,
  activeFilterCount,
  activeFiltersList,
  isFilterGroupActive,
  clearFilter,
  removeTagFilter,
  clearAllFilters,
  handleGeneClear,
  searchGeneSymbols,

  // Preset store integration for FilterDrawer
  visiblePresets,
  isPresetActive,
  onPresetToggle: handlePresetToggle,
  onPresetSave: () => {
    showSavePresetDialog.value = true
  },
  onPresetManage: () => {
    showManagePresetsDialog.value = true
  },
  hasActiveFiltersForSave: computed(
    () => hasActiveFilters.value || (props.columnActiveFilters?.length ?? 0) > 0
  ),

  // DSL search state for DslSearchBar in drawer
  dslInput,
  dslSuggestions,
  isDslMode,
  dslErrors,
  onDslApply: applyDslFilters,
  onDslClear: handleDslClear,
  onDslSuggestionSelect: applySuggestion,

  // Extension column filters (Task 12)
  caseId: computed(() => props.caseId),
  onColumnFiltersUpdate: (value) => {
    filters.value.columnFilters = value
  },
  onClearTypeFilter: handleClearTypeFilter
})

// Watch initialSearch prop to pre-populate search from cohort navigation
watch(
  () => props.initialSearch,
  (newSearch) => {
    if (newSearch !== undefined && newSearch !== '') {
      setInitialSearch(newSearch)
    }
  },
  { immediate: true }
)

// Export to Excel - wrapper that bridges composable result to emit events
const exportToExcel = async () => {
  const result = await composableExportToExcel(props.caseId, props.caseName)

  if (result === null) return

  if (!result.success && result.error !== undefined && result.error !== '') {
    emit('export-error', result.error)
  } else if (result.success && result.filePath !== undefined && result.filePath !== '') {
    const filePath = result.filePath
    emit('export-success', {
      filePath,
      action: {
        text: 'Open folder',
        callback: () => api?.export.revealInFolder(filePath)
      }
    })
  }
}

// Column preferences composable
const {
  prefs: columnPrefs,
  resetToDefaults: resetColumnDefaults,
  toggleColumnVisibility,
  setColumnOrder
} = useColumnPreferences('variant-table')

// Computed columns for ColumnsDrawer
const orderedColumns = computed(() => {
  if (!props.columns) return []
  if (columnPrefs.value.order.length > 0) {
    return [...props.columns].sort((a, b) => {
      const aIdx = columnPrefs.value.order.indexOf(a.key)
      const bIdx = columnPrefs.value.order.indexOf(b.key)
      if (aIdx === -1 && bIdx === -1) return 0
      if (aIdx === -1) return 1
      if (bIdx === -1) return -1
      return aIdx - bIdx
    })
  }
  return props.columns
})

const visibleColumnKeys = computed(() => {
  return orderedColumns.value
    .filter((h) => columnPrefs.value.visibility[h.key] !== false)
    .map((h) => h.key)
})

// Toggle drawer methods for keyboard shortcuts
const toggleFilterDrawer = () => {
  filterDrawerOpen.value = !filterDrawerOpen.value
}
const toggleColumnsDrawer = () => {
  columnsDrawerOpen.value = !columnsDrawerOpen.value
}

// Search field ref and focus method
const searchFieldRef = ref<InstanceType<typeof DslSearchBar> | null>(null)

function focusSearch(): void {
  searchFieldRef.value?.focus()
}

// Merge badge counts to include column filters + DSL filters
const mergedHasActiveFilters = computed(
  () =>
    hasActiveFilters.value || (props.columnActiveFilters?.length ?? 0) > 0 || hasDslFilters.value
)

const mergedActiveFilterCount = computed(
  () =>
    activeFilterCount.value +
    (props.columnActiveFilters?.length ?? 0) +
    Object.keys(dslColumnFilters.value).length
)

// Merge drawer active filters with column active filters
const mergedActiveFiltersList = computed(() => [
  ...activeFiltersList.value,
  ...(props.columnActiveFilters ?? [])
])

// Clear all: reset drawer filters + presets + DSL + notify parent to clear column filters
function handleClearAll() {
  handleDslClear() // Must be first — clears dslColumnFilters before filter watchers fire
  clearAllFilters()
  clearActivePresets()
  emit('clear-column-filters')
}

// Handle clear-filter — route column filter clears to parent
function handleClearFilter(filterId: string) {
  if (filterId.startsWith('col:')) {
    emit('clear-column-filter', filterId.slice(4))
  } else {
    clearFilter(filterId)
  }
}

/**
 * Clear all extension column filters for a given variant type (sv/cnv/str).
 * Strips every key matching `${typeKey}.*` from filters.columnFilters and
 * triggers a new filter emission so the query re-runs without them.
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

// Expose drawer toggles, search focus, and clear-all for parent keyboard shortcuts
defineExpose({
  toggleFilterDrawer,
  toggleColumnsDrawer,
  focusSearch,
  handleClearAll,
  filterOptions
})

// Load filter options and presets on mount
onMounted(async () => {
  const presetReason = await getCurrentUnsupportedReason('workflow.filterPresets')
  if (presetReason !== null) {
    warnUnsupported(presetReason)
    await loadFilterOptions(props.caseId)
    return
  }

  await Promise.all([loadFilterOptions(props.caseId), loadPresets()])
})
</script>

<style scoped>
.filter-search-input {
  min-width: 180px;
  max-width: 320px;
  flex-shrink: 1;
  flex-grow: 1;
}

/* Annotation hint bar */
.annotation-hint-bar {
  display: flex;
  align-items: center;
  padding: 6px 16px;
  background: color-mix(in srgb, rgb(var(--v-theme-warning)) 8%, transparent);
  border-top: 1px solid rgba(var(--v-border-color), 0.08);
  color: color-mix(in srgb, rgb(var(--v-theme-on-surface)) 70%, transparent);
}
</style>
