<template>
  <div class="cohort-content">
    <v-tabs v-model="activeTab" color="primary" density="compact" class="cohort-tabs flex-grow-0">
      <v-tab value="variants">Variants</v-tab>
      <v-tab value="burden">Gene Burden</v-tab>
    </v-tabs>

    <v-tabs-window v-model="activeTab" class="flex-grow-1" style="min-height: 0; overflow: hidden">
      <v-tabs-window-item value="variants" class="fill-height">
        <CohortTable
          ref="cohortTableRef"
          @navigate-to-case="$emit('navigate-to-case', $event)"
          @row-click="$emit('row-click', $event)"
        />
      </v-tabs-window-item>
      <v-tabs-window-item value="burden" class="fill-height" style="overflow-y: auto">
        <GeneBurdenView ref="burdenViewRef" />
      </v-tabs-window-item>
    </v-tabs-window>
  </div>
</template>

<script setup lang="ts">
import { ref, provide } from 'vue'
import CohortTable from './CohortTable.vue'
import GeneBurdenView from './association/GeneBurdenView.vue'
import { FiltersKey, createFilters } from '../composables/useFilters'
import type { CohortVariant } from '../../../shared/types/cohort'

// Create and provide filter state for child components (CohortTable, CohortFilterBar)
const filtersInstance = createFilters()
provide(FiltersKey, filtersInstance)

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

const activeTab = ref('variants')
const cohortTableRef = ref<InstanceType<typeof CohortTable> | null>(null)
const burdenViewRef = ref<InstanceType<typeof GeneBurdenView> | null>(null)

const refresh = async (): Promise<void> => {
  if (activeTab.value === 'variants') {
    await cohortTableRef.value?.refresh()
  } else {
    await burdenViewRef.value?.refresh()
  }
}

defineExpose({ refresh })
</script>

<style scoped>
.cohort-content {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 48px - 32px);
  overflow: hidden;
}

.cohort-tabs :deep(.v-tab--selected) {
  font-weight: 700;
  background-color: rgba(var(--v-theme-primary), 0.12);
  border-bottom: 3px solid rgb(var(--v-theme-primary));
}

.cohort-tabs :deep(.v-tab:not(.v-tab--selected)) {
  opacity: 0.6;
}
</style>
