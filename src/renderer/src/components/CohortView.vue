<template>
  <v-container fluid class="pa-4">
    <CohortDashboard ref="dashboardRef" />
    <CohortTable
      ref="cohortTableRef"
      @navigate-to-case="$emit('navigate-to-case', $event)"
      @row-click="$emit('row-click', $event)"
    />
  </v-container>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import CohortDashboard from './CohortDashboard.vue'
import CohortTable from './CohortTable.vue'
import type { CohortVariant } from '../../../shared/types/cohort'

// Emit for navigation and row click
defineEmits<{
  'navigate-to-case': [
    payload: {
      caseId: number
      chr: string
      pos: number
      ref: string
      alt: string
      geneSymbol: string | null
      cdna: string | null
    }
  ]
  'row-click': [variant: CohortVariant]
}>()

const dashboardRef = ref<InstanceType<typeof CohortDashboard> | null>(null)
const cohortTableRef = ref<InstanceType<typeof CohortTable> | null>(null)

// Refresh function that delegates to all child components
const refresh = async (): Promise<void> => {
  await dashboardRef.value?.refresh()
  await cohortTableRef.value?.refresh()
}

// Expose refresh method to parent
defineExpose({ refresh })
</script>
