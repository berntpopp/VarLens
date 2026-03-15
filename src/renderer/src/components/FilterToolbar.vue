<template>
  <SlimFilterToolbar
    :filtered-count="filteredCount"
    :total-count="totalCount"
    :has-active-filters="hasActiveFilters"
    :has-clearable-state="props.hasSort"
    :active-filter-count="activeFilterCount"
    :active-filters-list="activeFiltersList"
    :exporting="exporting"
    :columns="columns"
    @clear-all="clearAllFilters"
    @clear-filter="clearFilter"
    @open-filter-drawer="filterDrawerOpen = true"
    @open-columns-drawer="columnsDrawerOpen = true"
    @export="exportToExcel"
  >
    <template #filters>
      <!-- Search field -->
      <v-text-field
        ref="searchFieldRef"
        v-model="filters.searchQuery"
        variant="outlined"
        hide-details
        clearable
        placeholder="Gene, chr:pos, c./p. HGVS..."
        prepend-inner-icon="mdi-magnify"
        class="filter-search-input mr-2"
        :class="{ 'filter-active': filters.searchQuery !== '' }"
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
    </template>
  </SlimFilterToolbar>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, provide } from 'vue'
import type { VTextField } from 'vuetify/components'
import { useFilterState } from '../composables/useFilterState'
import { useColumnPreferences } from '../composables/useColumnPreferences'
import SlimFilterToolbar from './SlimFilterToolbar.vue'
import AnnotationScopeToggle from './AnnotationScopeToggle.vue'
import ColumnsDrawer from './ColumnsDrawer.vue'
import FilterDrawer from './FilterDrawer.vue'
import type { VariantFilter, Tag } from '../../../shared/types/api'
import type { FilterDrawerState } from './filterDrawerTypes'
import { ACMG_FILTER_OPTIONS } from '../utils/filters'

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
}

const props = defineProps<Props>()

interface Emits {
  (e: 'update:filters', filters: Omit<VariantFilter, 'case_id'>): void
  (e: 'reset-sort'): void
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
  searchGeneSymbols
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
const searchFieldRef = ref<InstanceType<typeof VTextField> | null>(null)

function focusSearch(): void {
  const input = searchFieldRef.value?.$el?.querySelector('input') as HTMLInputElement | null
  input?.focus()
}

// Expose drawer toggles and search focus for parent keyboard shortcuts
defineExpose({ toggleFilterDrawer, toggleColumnsDrawer, focusSearch })

// Load filter options on mount
onMounted(async () => {
  await loadFilterOptions(props.caseId)
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
