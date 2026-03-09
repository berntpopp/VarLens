<script setup lang="ts">
import { computed } from 'vue'
import EmptyState from '../components/EmptyState.vue'
import FilterToolbar from '../components/FilterToolbar.vue'
import VariantTable from '../components/VariantTable.vue'
import { useAppState } from '../composables/useAppState'
import type { VariantFilter, Variant } from '../../../shared/types/api'
import { APP_CONFIG } from '../../../shared/config/app.config'

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
  showSnack
} = useAppState()

const hasCases = computed(() => caseCount.value > 0)

function handleImportClick(): void {
  // Delegate to parent App.vue via event bus or direct ref
  // For now, emit - App.vue will handle
  sidebarOpen.value = true
}

function handleFiltersUpdate(filters: Omit<VariantFilter, 'case_id'>): void {
  currentFilters.value = filters
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

// filterToolbarRef is used as template ref (not detected by vue-tsc from destructured composable)
void filterToolbarRef

defineExpose({
  handleImportClick
})
</script>

<template>
  <EmptyState v-if="!selectedCaseId" :has-cases="hasCases" @import="handleImportClick" />
  <div v-else class="case-content">
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
        @update:filters="handleFiltersUpdate"
        @reset-sort="handleResetSort"
        @export-success="handleExportSuccess"
        @export-error="handleExportError"
      />
    </div>
    <VariantTable
      ref="variantTableRef"
      :case-id="selectedCaseId"
      :filters="currentFilters"
      @update:counts="handleCountsUpdate"
      @update:has-sort="handleSortUpdate"
      @row-click="handleRowClick"
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
</style>
