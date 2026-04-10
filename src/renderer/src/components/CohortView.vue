<template>
  <div class="cohort-content">
    <div class="cohort-header d-flex align-center ga-2 pa-2 flex-grow-0">
      <v-select
        v-model="genomeBuild"
        :items="availableBuilds"
        :item-title="(b) => `${b.build} (${b.caseCount} cases)`"
        item-value="build"
        density="compact"
        variant="outlined"
        hide-details
        label="Genome Build"
        style="max-width: 220px"
      />
      <v-select
        v-model="selectedVariantType"
        :items="variantTypeOptions"
        item-title="label"
        item-value="value"
        density="compact"
        variant="outlined"
        hide-details
        label="Variant Type"
        style="max-width: 180px"
      />
      <v-spacer />
    </div>

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
import { ref, provide, onActivated, onMounted, watch } from 'vue'
import CohortTable from './CohortTable.vue'
import GeneBurdenView from './association/GeneBurdenView.vue'
import { FiltersKey, createFilters } from '../composables/useFilters'
import { CohortDataKey, useCohortData } from '../composables/useCohortData'
import { useAppState } from '../composables/useAppState'
import type { CohortVariant } from '../../../shared/types/cohort'
import { logService } from '../services/LogService'

// Create and provide filter state for child components (CohortTable, CohortFilterBar)
const filtersInstance = createFilters()
provide(FiltersKey, filtersInstance)

// Create and provide cohort data state so the genome build / variant type
// selectors in this header share the same refs as the CohortTable below.
// CohortTable's internal useCohortData() call will inject this same instance.
const cohortDataInstance = useCohortData()
provide(CohortDataKey, cohortDataInstance)
const { genomeBuild, selectedVariantType, availableBuilds, loadAvailableBuilds } =
  cohortDataInstance

const variantTypeOptions = [
  { value: 'snv', label: 'SNV/Indel' },
  { value: 'sv', label: 'SV' },
  { value: 'cnv', label: 'CNV' },
  { value: 'str', label: 'STR' }
]

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

onMounted(async () => {
  try {
    await loadAvailableBuilds()
  } catch (error) {
    logService.error(
      'Failed to load available genome builds: ' +
        (error instanceof Error ? error.message : String(error)),
      'cohort'
    )
  }
})

// Refetch cohort data when the user changes genome build or variant type.
// Skip the initial `ref` assignment — refresh() is a no-op before the table
// has mounted, and the first table fetch already uses the current values.
watch([genomeBuild, selectedVariantType], async () => {
  try {
    await refresh()
  } catch (error) {
    logService.error(
      'Failed to refresh cohort view after selector change: ' +
        (error instanceof Error ? error.message : String(error)),
      'cohort'
    )
  }
})

onActivated(async () => {
  if (dataGeneration.value !== lastSeenGeneration.value) {
    lastSeenGeneration.value = dataGeneration.value
    try {
      await refresh()
    } catch (error) {
      logService.error(
        'Failed to refresh cohort view on activation: ' +
          (error instanceof Error ? error.message : String(error)),
        'cohort'
      )
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
