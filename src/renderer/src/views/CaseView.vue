<script setup lang="ts">
import { ref, computed, onActivated, watch } from 'vue'
import type { ColumnFilterMeta } from '../../../shared/types/column-filters'
import type { AnnotationScope } from '../../../shared/types/annotations'
import EmptyState from '../components/EmptyState.vue'
import FilterToolbar from '../components/FilterToolbar.vue'
import VariantTable from '../components/VariantTable.vue'
import { useAppState } from '../composables/useAppState'
import type { VariantFilter, Variant } from '../../../shared/types/api'
import { APP_CONFIG } from '../../../shared/config/app.config'
import { logService } from '../services/LogService'
import { useApiService } from '../composables/useApiService'

const {
  selectedCaseId,
  selectedCaseName,
  currentFilters,
  filteredCount,
  totalCount,
  hasSort,
  initialSearch,
  caseCount,
  sidebarOpen,
  filterToolbarRef,
  variantTableRef,
  panelOpen,
  selectedPanelVariant,
  showSnack,
  dataGeneration
} = useAppState()

const { api } = useApiService()
const hasCases = computed(() => caseCount.value > 0)

// ── Variant type tabs ─────────────────────────────────────────
const selectedVariantType = ref<string>('snv')
const typeCounts = ref<Record<string, number>>({})

async function loadTypeCounts(caseId: number | null): Promise<void> {
  if (caseId === null || caseId === 0 || api === undefined) {
    typeCounts.value = {}
    return
  }
  try {
    typeCounts.value = await api.variants.typeCounts(caseId)
  } catch (error) {
    logService.error(
      'Failed to load variant type counts: ' +
        (error instanceof Error ? error.message : String(error)),
      'case'
    )
    typeCounts.value = {}
  }
}

// Load counts on case change
watch(
  selectedCaseId,
  (newCaseId) => {
    selectedVariantType.value = 'snv'
    void loadTypeCounts(newCaseId)
  },
  { immediate: true }
)

// Tab items — only show tabs that have variants
const tabItems = computed(() => {
  const counts = typeCounts.value
  const snvCount = (counts.snv ?? 0) + (counts.indel ?? 0)
  const items: { type: string; label: string; count: number }[] = [
    { type: 'snv', label: 'SNV/Indel', count: snvCount }
  ]
  if ((counts.sv ?? 0) > 0) items.push({ type: 'sv', label: 'SV', count: counts.sv! })
  if ((counts.cnv ?? 0) > 0) items.push({ type: 'cnv', label: 'CNV', count: counts.cnv! })
  if ((counts.str ?? 0) > 0) items.push({ type: 'str', label: 'STR', count: counts.str! })
  return items
})

const showVariantTypeTabs = computed(() => tabItems.value.length > 1)

// Effective filters include variant_type from tab selection
const effectiveFilters = computed<Omit<VariantFilter, 'case_id'>>(() => ({
  ...currentFilters.value,
  variant_type: selectedVariantType.value
}))

// Refresh type counts when data changes (import, delete)
watch(dataGeneration, () => {
  if (selectedCaseId.value !== null && selectedCaseId.value !== 0) {
    void loadTypeCounts(selectedCaseId.value)
  }
})

// KeepAlive stale data detection: refresh if data changed while view was cached
const lastSeenGeneration = ref(dataGeneration.value)
onActivated(async () => {
  if (dataGeneration.value !== lastSeenGeneration.value) {
    lastSeenGeneration.value = dataGeneration.value
    if (selectedCaseId.value != null) {
      try {
        await variantTableRef.value?.refresh()
      } catch (error) {
        logService.error(
          'Failed to refresh variant table on activation: ' +
            (error instanceof Error ? error.message : String(error)),
          'case'
        )
      }
    }
  }
})
const annotationScope = ref<AnnotationScope>('case')

// Pipe columnMeta from FilterToolbar (single owner of filter options) to VariantTable
// filterOptions is exposed as Ref<FilterOptions> from FilterToolbar; Vue template refs
// auto-unwrap refs from defineExpose, so .columnMeta is directly accessible.
const columnMeta = computed<ColumnFilterMeta[]>(
  () => filterToolbarRef.value?.filterOptions?.columnMeta ?? []
)

function handleImportClick(): void {
  // Delegate to parent App.vue via event bus or direct ref
  // For now, emit - App.vue will handle
  sidebarOpen.value = true
}

function handleFiltersUpdate(filters: Omit<VariantFilter, 'case_id'>): void {
  currentFilters.value = filters
  annotationScope.value = (filters.annotation_scope as AnnotationScope) ?? 'case'
  if (initialSearch.value !== undefined && filters.search_query != null) {
    initialSearch.value = undefined
  }
}

function handleResetSort(): void {
  variantTableRef.value?.resetSort()
}

function handleCountsUpdate(counts: { filtered: number; total: number }): void {
  filteredCount.value = counts.filtered
  totalCount.value = counts.total
}

function handleSortUpdate(sortActive: boolean): void {
  hasSort.value = sortActive
}

function handleRowClick(variant: Variant): void {
  selectedPanelVariant.value = variant
  panelOpen.value = true
}

function handleDeselect(): void {
  if (panelOpen.value) {
    panelOpen.value = false
  }
}

function handleExportSuccess(data: {
  filePath: string
  action: { text: string; callback: () => void }
}): void {
  showSnack(`Exported to ${data.filePath}`, 'success', {
    timeout: APP_CONFIG.SNACKBAR_SUCCESS_MS,
    action: data.action
  })
}

function handleExportError(error: string): void {
  showSnack(`Export failed: ${error}`, 'error', { timeout: APP_CONFIG.SNACKBAR_ERROR_MS })
}

function handleClearColumnFilters(): void {
  variantTableRef.value?.clearAllColumnFilters()
}

function handleClearColumnFilter(columnKey: string): void {
  variantTableRef.value?.clearColumnFilter(columnKey)
}

// filterToolbarRef is used as template ref (not detected by vue-tsc from destructured composable)
void filterToolbarRef

defineExpose({
  handleImportClick
})
</script>

<template>
  <EmptyState v-if="!selectedCaseId" :has-cases="hasCases" @import="handleImportClick" />
  <div v-else class="case-content">
    <!-- Variant type tabs (only shown when case has SV/CNV/STR data) -->
    <v-tabs
      v-if="showVariantTypeTabs"
      v-model="selectedVariantType"
      color="primary"
      density="compact"
      class="variant-type-tabs"
    >
      <v-tab v-for="item in tabItems" :key="item.type" :value="item.type">
        {{ item.label }}
        <v-chip size="x-small" class="ml-2" variant="tonal">{{ item.count }}</v-chip>
      </v-tab>
    </v-tabs>
    <div class="filter-bar-container">
      <FilterToolbar
        ref="filterToolbarRef"
        :case-id="selectedCaseId"
        :case-name="selectedCaseName"
        :filtered-count="filteredCount"
        :total-count="totalCount"
        :has-sort="hasSort"
        :initial-search="initialSearch"
        :columns="variantTableRef?.columns"
        :column-active-filters="variantTableRef?.columnActiveFilters"
        @update:filters="handleFiltersUpdate"
        @reset-sort="handleResetSort"
        @export-success="handleExportSuccess"
        @export-error="handleExportError"
        @clear-column-filters="handleClearColumnFilters"
        @clear-column-filter="handleClearColumnFilter"
      />
    </div>
    <VariantTable
      ref="variantTableRef"
      :case-id="selectedCaseId"
      :filters="effectiveFilters"
      :variant-type="selectedVariantType"
      :annotation-scope="annotationScope"
      :column-meta="columnMeta"
      @update:counts="handleCountsUpdate"
      @update:has-sort="handleSortUpdate"
      @row-click="handleRowClick"
      @deselect="handleDeselect"
      @clear-filters="filterToolbarRef?.handleClearAll()"
    />
  </div>
</template>

<style scoped>
.filter-bar-container {
  background: rgb(var(--v-theme-surface));
}

.case-content {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 48px - 32px);
  overflow: hidden;
}

.variant-type-tabs {
  border-bottom: 1px solid rgb(var(--v-theme-outline));
  background: rgb(var(--v-theme-surface));
  flex: 0 0 auto;
}

.variant-type-tabs :deep(.v-tab) {
  min-height: 36px;
  text-transform: none;
  font-weight: 500;
}
</style>
