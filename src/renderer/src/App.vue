<template>
  <v-app>
    <AppSidebar>
      <CaseList @case-selected="handleCaseSelected" @case-deleted="handleCaseDeleted" />
    </AppSidebar>

    <v-main>
      <EmptyState v-if="!selectedCaseId" />
      <VariantTable v-else :case-id="selectedCaseId" />
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import AppSidebar from './components/AppSidebar.vue'
import CaseList from './components/CaseList.vue'
import EmptyState from './components/EmptyState.vue'
import VariantTable from './components/VariantTable.vue'

// Case selection state
const selectedCaseId = ref<number | null>(null)

const handleCaseSelected = (caseId: number): void => {
  selectedCaseId.value = caseId
}

const handleCaseDeleted = (caseId: number): void => {
  // If deleted case was selected, clear selection
  if (selectedCaseId.value === caseId) {
    selectedCaseId.value = null
  }
}
</script>
