<template>
  <v-container fluid class="pa-4">
    <CohortDashboard ref="dashboardRef" />
    <CohortTable ref="cohortTableRef" @navigate-to-case="$emit('navigate-to-case', $event)" />
    <v-divider class="my-4" />
    <div class="text-h6 mb-3">
      <v-icon start>mdi-dna</v-icon>
      Gene Burden
    </div>
    <GeneBurdenTable ref="geneBurdenRef" />
  </v-container>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import CohortDashboard from './CohortDashboard.vue'
import CohortTable from './CohortTable.vue'
import GeneBurdenTable from './GeneBurdenTable.vue'

// Emit for navigation
defineEmits<{
  'navigate-to-case': [
    payload: { caseId: number; chr: string; pos: number; ref: string; alt: string }
  ]
}>()

const dashboardRef = ref<InstanceType<typeof CohortDashboard> | null>(null)
const cohortTableRef = ref<InstanceType<typeof CohortTable> | null>(null)
const geneBurdenRef = ref<InstanceType<typeof GeneBurdenTable> | null>(null)

// Refresh function that delegates to all child components
const refresh = async (): Promise<void> => {
  await dashboardRef.value?.refresh()
  await cohortTableRef.value?.refresh()
  await geneBurdenRef.value?.refresh()
}

// Expose refresh method to parent
defineExpose({ refresh })
</script>
