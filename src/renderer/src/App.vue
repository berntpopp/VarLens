<template>
  <v-app>
    <AppSidebar>
      <CaseList @case-selected="handleCaseSelected" @case-deleted="handleCaseDeleted" />
    </AppSidebar>

    <v-main>
      <!-- Conditional: EmptyState when no case selected, variant table when selected -->
      <EmptyState v-if="!selectedCaseId" />
      <!-- Future: VariantTable v-else :case-id="selectedCaseId" -->
      <v-container v-else class="fill-height">
        <v-row align="center" justify="center">
          <v-col cols="12" class="text-center">
            <v-icon size="80" color="primary">mdi-dna</v-icon>
            <h2 class="text-h5 mt-4">Case Selected</h2>
            <p class="text-body-1 mt-2 text-grey">
              Case ID: {{ selectedCaseId }} - Variant table coming in Phase 6
            </p>
          </v-col>
        </v-row>
      </v-container>
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import AppSidebar from './components/AppSidebar.vue'
import CaseList from './components/CaseList.vue'
import EmptyState from './components/EmptyState.vue'

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
