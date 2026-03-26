<template>
  <div class="cohort-content">
    <v-tabs v-model="activeTab" color="primary" density="compact" class="cohort-tabs flex-grow-0">
      <v-tab value="variants">Variants</v-tab>
      <v-tab value="burden">Gene Burden</v-tab>
    </v-tabs>

    <v-tabs-window
      v-model="activeTab"
      class="flex-grow-1 cohort-tabs-window"
      style="min-height: 0; overflow: hidden"
      transition="none"
      reverse-transition="none"
    >
      <v-tabs-window-item value="variants" class="fill-height">
        <CohortTable
          ref="cohortTableRef"
          @navigate-to-case="$emit('navigate-to-case', $event)"
          @row-click="$emit('row-click', $event)"
          @deselect="$emit('deselect')"
        />
      </v-tabs-window-item>
      <v-tabs-window-item value="burden" class="fill-height" style="overflow-y: auto">
        <GeneBurdenView v-if="burdenMounted" ref="burdenViewRef" />
      </v-tabs-window-item>
    </v-tabs-window>
  </div>
</template>

<script setup lang="ts">
import { ref, provide, onActivated, watch } from 'vue'
import CohortTable from './CohortTable.vue'
import GeneBurdenView from './association/GeneBurdenView.vue'
import { FiltersKey, createFilters } from '../composables/useFilters'
import { useAppState } from '../composables/useAppState'
import type { CohortVariant } from '../../../shared/types/cohort'

// Create and provide filter state for child components (CohortTable, CohortFilterBar)
const filtersInstance = createFilters()
provide(FiltersKey, filtersInstance)

// KeepAlive stale data detection: refresh if data changed while view was cached
const { dataGeneration } = useAppState()
const lastSeenGeneration = ref(dataGeneration.value)

// Defer GeneBurdenView mount until the burden tab is first activated.
// Prevents N+1 IPC calls (getFullMetadata per case) from firing when
// the user only visits the Variants tab.
const burdenMounted = ref(false)

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
  deselect: []
}>()

const activeTab = ref('variants')
const cohortTableRef = ref<InstanceType<typeof CohortTable> | null>(null)
const burdenViewRef = ref<InstanceType<typeof GeneBurdenView> | null>(null)

// Mount GeneBurdenView on first tab switch (stays mounted for KeepAlive)
watch(activeTab, (tab) => {
  if (tab === 'burden' && !burdenMounted.value) {
    burdenMounted.value = true
  }
})

const refresh = async (): Promise<void> => {
  if (activeTab.value === 'variants') {
    await cohortTableRef.value?.refresh()
  } else {
    await burdenViewRef.value?.refresh()
  }
}

onActivated(async () => {
  if (dataGeneration.value !== lastSeenGeneration.value) {
    lastSeenGeneration.value = dataGeneration.value
    try {
      await refresh()
    } catch (error) {
      console.error('Failed to refresh cohort view on activation:', error)
    }
  }
})

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

/* Prevent dual-display glitch during tab switch (Vuetify bug #19682).
   Use height: 100% instead of auto to maintain flex height chain for pagination. */
.cohort-tabs-window :deep(.v-window__container) {
  display: block !important;
  height: 100% !important;
  transition: none !important;
}

/* Ensure tab window items fill their container height */
.cohort-tabs-window :deep(.v-window-item) {
  height: 100%;
}

.cohort-tabs-window :deep(.v-window-item:not(.v-window-item--active)) {
  display: none !important;
}
</style>
