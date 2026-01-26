<template>
  <v-app>
    <AppSidebar @import-click="handleImportClick">
      <CaseList
        ref="caseListRef"
        @case-selected="handleCaseSelected"
        @case-deleted="handleCaseDeleted"
        @cases-loaded="handleCasesLoaded"
      />
    </AppSidebar>

    <v-main>
      <EmptyState v-if="!selectedCaseId" :has-cases="caseCount > 0" @import="handleImportClick" />
      <template v-else>
        <FilterToolbar
          :case-id="selectedCaseId"
          :filtered-count="filteredCount"
          :total-count="totalCount"
          :has-sort="hasSort"
          @update:filters="handleFiltersUpdate"
          @reset-sort="handleResetSort"
        />
        <VariantTable
          ref="variantTableRef"
          :case-id="selectedCaseId"
          :filters="currentFilters"
          @update:counts="handleCountsUpdate"
          @update:has-sort="handleSortUpdate"
        />
      </template>
    </v-main>

    <ImportDialog ref="importDialogRef" @import-complete="handleImportComplete" />
    <AppSnackbar ref="snackbarRef" />
  </v-app>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import AppSidebar from './components/AppSidebar.vue'
import CaseList from './components/CaseList.vue'
import EmptyState from './components/EmptyState.vue'
import VariantTable from './components/VariantTable.vue'
import FilterToolbar from './components/FilterToolbar.vue'
import ImportDialog from './components/ImportDialog.vue'
import AppSnackbar from './components/AppSnackbar.vue'
import type { VariantFilter } from '../../shared/types/api'

// Component refs
const importDialogRef = ref<InstanceType<typeof ImportDialog> | null>(null)
const snackbarRef = ref<InstanceType<typeof AppSnackbar> | null>(null)
const caseListRef = ref<InstanceType<typeof CaseList> | null>(null)
const variantTableRef = ref<InstanceType<typeof VariantTable> | null>(null)

// Case selection state
const selectedCaseId = ref<number | null>(null)
const caseCount = ref(0)

// Filter state (lifted to App for coordination)
const currentFilters = ref<Omit<VariantFilter, 'case_id'>>({})
const filteredCount = ref(0)
const totalCount = ref(0)
const hasSort = ref(false)

const handleImportClick = (): void => {
  importDialogRef.value?.show()
}

const handleImportComplete = async (result: {
  caseId: number
  variantCount: number
  caseName: string
}): Promise<void> => {
  // Refresh case list to include new case
  await caseListRef.value?.refreshCases()

  // Auto-select the newly imported case
  caseListRef.value?.selectCase(result.caseId)

  // Show success snackbar
  snackbarRef.value?.show(
    `Case imported: ${result.caseName} (${result.variantCount.toLocaleString()} variants)`,
    'success'
  )
}

const handleCaseSelected = (caseId: number): void => {
  selectedCaseId.value = caseId
}

const handleCasesLoaded = (count: number): void => {
  caseCount.value = count
}

const handleCaseDeleted = (caseId: number): void => {
  // If deleted case was selected, clear selection
  if (selectedCaseId.value === caseId) {
    selectedCaseId.value = null
  }
}

const handleFiltersUpdate = (filters: Omit<VariantFilter, 'case_id'>): void => {
  currentFilters.value = filters
}

const handleResetSort = (): void => {
  variantTableRef.value?.resetSort()
}

const handleCountsUpdate = (counts: { filtered: number; total: number }): void => {
  filteredCount.value = counts.filtered
  totalCount.value = counts.total
}

const handleSortUpdate = (sortActive: boolean): void => {
  hasSort.value = sortActive
}

// Clear filters and sort on case change
watch(selectedCaseId, () => {
  currentFilters.value = {}
  hasSort.value = false
})
</script>
