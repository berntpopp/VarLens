<template>
  <v-app>
    <AppSidebar>
      <CaseList @case-selected="handleCaseSelected" @case-deleted="handleCaseDeleted" />
    </AppSidebar>

    <v-main>
      <EmptyState v-if="!selectedCaseId" />
      <template v-else>
        <FilterToolbar
          :case-id="selectedCaseId"
          :filtered-count="filteredCount"
          :total-count="totalCount"
          @update:filters="handleFiltersUpdate"
        />
        <VariantTable
          :case-id="selectedCaseId"
          :filters="currentFilters"
          @update:counts="handleCountsUpdate"
        />
      </template>
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import AppSidebar from './components/AppSidebar.vue'
import CaseList from './components/CaseList.vue'
import EmptyState from './components/EmptyState.vue'
import VariantTable from './components/VariantTable.vue'
import FilterToolbar from './components/FilterToolbar.vue'
import type { VariantFilter } from '../../shared/types/api'

// Case selection state
const selectedCaseId = ref<number | null>(null)

// Filter state (lifted to App for coordination)
const currentFilters = ref<Omit<VariantFilter, 'case_id'>>({})
const filteredCount = ref(0)
const totalCount = ref(0)

const handleCaseSelected = (caseId: number): void => {
  selectedCaseId.value = caseId
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

const handleCountsUpdate = (counts: { filtered: number; total: number }): void => {
  filteredCount.value = counts.filtered
  totalCount.value = counts.total
}

// Clear filters on case change
watch(selectedCaseId, () => {
  currentFilters.value = {}
})
</script>
