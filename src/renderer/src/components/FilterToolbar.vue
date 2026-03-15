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
        @apply="parseNow"
        @clear="clearDsl(); filters.searchQuery = ''; dslColumnFilters = {}"
        @select-suggestion="applySuggestion"
      />

      <!-- Annotation scope toggle -->
      <AnnotationScopeToggle v-model="filters.annotationScope" class="mr-2" />

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
            <v-icon size="small">{{
              filters.starredOnly ? 'mdi-star' : 'mdi-star-outline'
            }}</v-icon>
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
            <v-icon size="small">{{
              filters.hasCommentOnly ? 'mdi-comment-text' : 'mdi-comment-text-outline'
            }}</v-icon>
          </v-btn>
        </template>
        {{
          filters.hasCommentOnly
            ? 'Showing commented only — click to clear'
            : 'Show variants with comments only'
        }}
      </v-tooltip>

      <!-- ACMG classification chips -->
      <v-chip-group v-model="filters.acmgClassifications" multiple class="ml-2 flex-nowrap">
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

      <!-- Tag filter -->
      <v-select
        v-if="availableTags.length > 0"
        v-model="filters.tagIds"
        :items="availableTags"
        item-title="name"
        item-value="id"
        multiple
        chips
        closable-chips
        density="compact"
        variant="outlined"
        hide-details
        clearable
        placeholder="Tags..."
        prepend-inner-icon="mdi-tag-multiple"
        class="filter-tag-input ml-1"
        :class="{ 'filter-active': filters.tagIds.length > 0 }"
      >
        <template #chip="{ item }">
          <v-chip
            closable
            size="x-small"
            :color="(item as unknown as Tag).color"
            variant="flat"
            @click:close="removeTagFilter((item as unknown as Tag).id)"
          >
            {{ (item as unknown as Tag).name }}
          </v-chip>
        </template>
        <template #item="{ item, props: itemProps }">
          <v-list-item v-bind="itemProps" :title="undefined">
            <template #prepend>
              <v-icon :color="(item as unknown as Tag).color" size="small">mdi-circle</v-icon>
            </template>
            <v-list-item-title>{{ (item as unknown as Tag).name }}</v-list-item-title>
          </v-list-item>
        </template>
      </v-select>
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
          <v-icon size="small" class="mr-1">mdi-information-outline</v-icon>
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
import { ref, computed, watch, onMounted, provide, nextTick } from 'vue'
import { useFilterState } from '../composables/useFilterState'
import { useColumnPreferences } from '../composables/useColumnPreferences'
import { useFilterPresetStore } from '../composables/useFilterPresetStore'
import { useDslSearch } from '../composables/useDslSearch'
import SlimFilterToolbar from './SlimFilterToolbar.vue'
import AnnotationScopeToggle from './AnnotationScopeToggle.vue'
import DslSearchBar from './DslSearchBar.vue'
import ColumnsDrawer from './ColumnsDrawer.vue'
import FilterDrawer from './FilterDrawer.vue'
import PresetBar from './PresetBar.vue'
import PresetSaveDialog from './PresetSaveDialog.vue'
import PresetManageDialog from './PresetManageDialog.vue'
import type { VariantFilter, Tag } from '../../../shared/types/api'
import type { ActiveFilter } from '../../../shared/types/filters'
import type { FilterDrawerState } from './filterDrawerTypes'
import { ACMG_FILTER_OPTIONS, applyPresetStateToFilters, isPresetDiverged } from '../utils/filters'

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
  exportToExcel: composableExportToExcel
} = useFilterState(
  computed(() => props.caseId),
  {
    onFiltersUpdate: (f) => emit('update:filters', f),
    onResetSort: () => emit('reset-sort')
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

// DSL search — uses preset names for @preset autocomplete
const {
  rawInput: dslInput,
  translationResult: dslTranslation,
  suggestions: dslSuggestions,
  isDslMode,
  ftsQuery,
  errors: dslErrors,
  applySuggestion,
  clear: clearDsl,
  parseNow
} = useDslSearch(() =>
  allPresets.value.map((p) => p.name.toLowerCase().replace(/\s+/g, '_'))
)

// Track DSL-produced column filters separately so we can clear them
const dslColumnFilters = ref<Record<string, unknown>>({})

// When DSL translation changes, apply results to filter state
watch(
  () => dslTranslation.value,
  (translation) => {
    if (isDslMode.value && Object.keys(translation.columnFilters).length > 0) {
      // Store DSL column filters so we can clear them later
      dslColumnFilters.value = { ...translation.columnFilters }

      // Clear drawer equivalents for DSL-filtered columns to prevent conflicts
      if (translation.columnFilters.gnomad_af) filters.value.maxGnomadAf = null
      if (translation.columnFilters.cadd) filters.value.minCadd = null
    }

    // Resolve @preset references
    for (const presetName of translation.presetNames) {
      const preset = allPresets.value.find(
        (p) => p.name.toLowerCase().replace(/\s+/g, '_') === presetName
      )
      if (preset && !isPresetActive(preset.id)) {
        handlePresetToggle(preset.id)
      }
    }
  }
)

// FTS mode: update searchQuery from DSL composable
watch(ftsQuery, (query) => {
  if (!isDslMode.value) {
    filters.value.searchQuery = query
  }
})

// Dialog state
const showSavePresetDialog = ref(false)
const showManagePresetsDialog = ref(false)
const savingPreset = ref(false)
let applyingPresets = false // guard to skip divergence check during applyActivePresets

// Preset toggle handler — applies merged preset filters
function handlePresetToggle(presetId: number): void {
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
watch(
  filters,
  () => {
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
  },
  { deep: true }
)

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

// Toggle methods for star/comment
const toggleStarred = () => {
  filters.value.starredOnly = !filters.value.starredOnly
}
const toggleCommented = () => {
  filters.value.hasCommentOnly = !filters.value.hasCommentOnly
}

// ACMG classification options (shared constant)
const acmgFilterOptions = ACMG_FILTER_OPTIONS

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
  )
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
    emit('export-success', {
      filePath: result.filePath,
      action: {
        text: 'Open folder',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-undef
        callback: () => (window as any).api.shell.showItemInFolder(result.filePath)
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

// Merge badge counts to include column filters
const mergedHasActiveFilters = computed(
  () => hasActiveFilters.value || (props.columnActiveFilters?.length ?? 0) > 0
)

const mergedActiveFilterCount = computed(
  () => activeFilterCount.value + (props.columnActiveFilters?.length ?? 0)
)

// Merge drawer active filters with column active filters
const mergedActiveFiltersList = computed(() => [
  ...activeFiltersList.value,
  ...(props.columnActiveFilters ?? [])
])

// Clear all: reset drawer filters + presets + DSL + notify parent to clear column filters
function handleClearAll() {
  clearAllFilters()
  clearActivePresets()
  clearDsl()
  dslColumnFilters.value = {}
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

// Expose drawer toggles and search focus for parent keyboard shortcuts
defineExpose({ toggleFilterDrawer, toggleColumnsDrawer, focusSearch })

// Load filter options and presets on mount
onMounted(async () => {
  await loadFilterOptions(props.caseId)
  await loadPresets()
})
</script>

<style scoped>
.filter-search-input {
  min-width: 300px;
  flex-shrink: 1;
  flex-grow: 1;
}

.filter-tag-input {
  max-width: 200px;
  flex-shrink: 1;
  align-self: center;
}

.filter-tag-input :deep(.v-field) {
  border-radius: 6px;
  border-color: rgba(0, 0, 0, 0.15);
  min-height: 32px;
}

.filter-tag-input :deep(.v-field__input) {
  font-size: 0.85rem;
  padding-top: 2px;
  padding-bottom: 2px;
  min-height: 32px;
}

.filter-tag-input.filter-active :deep(.v-field) {
  border-color: rgb(var(--v-theme-primary));
  border-width: 2px;
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 4%, transparent);
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
