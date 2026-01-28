<template>
  <v-container fluid class="pa-4">
    <CohortTable ref="cohortTableRef" />
  </v-container>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import CohortTable from './CohortTable.vue'

const cohortTableRef = ref<InstanceType<typeof CohortTable> | null>(null)

// Refresh function that delegates to child table
const refresh = async (): Promise<void> => {
  await cohortTableRef.value?.refresh()
}

// Expose refresh method to parent
defineExpose({ refresh })
</script>
