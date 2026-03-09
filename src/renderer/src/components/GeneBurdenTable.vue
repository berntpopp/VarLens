<template>
  <div>
    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-3" />
    <v-data-table
      v-model:items-per-page="itemsPerPage"
      :headers="headers"
      :items="geneBurden"
      :items-per-page-options="[10, 25, 50, 100]"
      :sort-by="[{ key: 'affected_case_count', order: 'desc' }]"
      density="compact"
      class="elevation-1"
    >
      <!-- Gene symbol -->
      <template #[`item.gene_symbol`]="{ value }">
        <span class="gene-symbol font-weight-medium">{{ value }}</span>
      </template>

      <!-- Variant count -->
      <template #[`item.variant_count`]="{ value }">
        <span class="font-weight-medium">{{ value }}</span>
      </template>

      <!-- Unique variant count -->
      <template #[`item.unique_variant_count`]="{ value }">
        <span>{{ value }}</span>
      </template>

      <!-- Affected case count -->
      <template #[`item.affected_case_count`]="{ value }">
        <v-chip size="small" color="primary" label>
          {{ value }}
        </v-chip>
      </template>

      <!-- Case frequency -->
      <template #[`item.case_frequency`]="{ item }">
        <span class="text-body-small">
          {{ item.affected_case_count }} / {{ item.total_cases }} ({{
            formatPercentage(item.affected_case_count / item.total_cases)
          }})
        </span>
      </template>
    </v-data-table>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import type { GeneBurden } from '../../../shared/types/cohort'
import { useSettingsStore } from '../stores/settingsStore'
import { useApiService } from '../composables/useApiService'

// API service
const { api } = useApiService()

// Settings store for persisted items-per-page
const settingsStore = useSettingsStore()

// State
const geneBurden = ref<GeneBurden[]>([])
const loading = ref(false)
const itemsPerPage = ref(settingsStore.itemsPerPage)

// Sync items-per-page changes back to settings store
watch(itemsPerPage, (v) => {
  settingsStore.itemsPerPage = v
})

// Table headers
const headers = [
  { title: 'Gene', key: 'gene_symbol', sortable: true },
  { title: 'Total Variants', key: 'variant_count', sortable: true, align: 'end' as const },
  {
    title: 'Unique Variants',
    key: 'unique_variant_count',
    sortable: true,
    align: 'end' as const
  },
  { title: 'Cases Affected', key: 'affected_case_count', sortable: true, align: 'end' as const },
  { title: 'Case Frequency', key: 'case_frequency', sortable: true, align: 'end' as const }
]

// Load gene burden data
const loadGeneBurden = async (): Promise<void> => {
  // Guard for browser dev mode (no preload)
  if (!api) return

  loading.value = true
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (api as any).cohort.getGeneBurden()
    geneBurden.value = result
  } catch (error) {
    // eslint-disable-next-line no-undef
    console.error('Failed to load gene burden:', error)
    geneBurden.value = []
  } finally {
    loading.value = false
  }
}

// Formatting function
const formatPercentage = (value: number): string => {
  return `${(value * 100).toFixed(1)}%`
}

// Refresh function (called by parent)
const refresh = async (): Promise<void> => {
  await loadGeneBurden()
}

// Load on mount
onMounted(async () => {
  await loadGeneBurden()
})

// Expose refresh method to parent
defineExpose({ refresh })
</script>

<style scoped>
.gene-symbol {
  font-family: 'Courier New', monospace;
}
</style>
