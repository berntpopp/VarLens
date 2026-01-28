<template>
  <v-expansion-panels v-model="expanded" class="mb-4">
    <v-expansion-panel>
      <v-expansion-panel-title>
        <v-icon start>mdi-chart-bar</v-icon>
        <span class="text-h6">Cohort Summary</span>
      </v-expansion-panel-title>
      <v-expansion-panel-text>
        <v-skeleton-loader v-if="loading" type="card" />
        <v-row v-else dense>
          <v-col cols="12" sm="6" md="3" lg="3">
            <v-card variant="tonal" class="pa-3">
              <div class="d-flex align-center mb-2">
                <v-icon start color="primary">mdi-account-group</v-icon>
                <span class="text-caption">Total Cases</span>
              </div>
              <div class="text-h4">{{ summary.total_cases }}</div>
            </v-card>
          </v-col>
          <v-col cols="12" sm="6" md="3" lg="3">
            <v-card variant="tonal" class="pa-3">
              <div class="d-flex align-center mb-2">
                <v-icon start color="primary">mdi-dna</v-icon>
                <span class="text-caption">Total Variants</span>
              </div>
              <div class="text-h4">{{ formatNumber(summary.total_variants) }}</div>
            </v-card>
          </v-col>
          <v-col cols="12" sm="6" md="3" lg="3">
            <v-card variant="tonal" class="pa-3">
              <div class="d-flex align-center mb-2">
                <v-icon start color="primary">mdi-fingerprint</v-icon>
                <span class="text-caption">Unique Variants</span>
              </div>
              <div class="text-h4">{{ formatNumber(summary.unique_variants) }}</div>
            </v-card>
          </v-col>
          <v-col cols="12" sm="6" md="3" lg="3">
            <v-card variant="tonal" class="pa-3">
              <div class="d-flex align-center mb-2">
                <v-icon start color="primary">mdi-calculator</v-icon>
                <span class="text-caption">Avg Variants/Case</span>
              </div>
              <div class="text-h4">{{ formatDecimal(summary.avg_variants_per_case) }}</div>
            </v-card>
          </v-col>
          <v-col cols="12" sm="6" md="3" lg="3">
            <v-card variant="tonal" class="pa-3">
              <div class="d-flex align-center mb-2">
                <v-icon start color="primary">mdi-gene</v-icon>
                <span class="text-caption">Genes with Variants</span>
              </div>
              <div class="text-h4">{{ summary.genes_with_variants }}</div>
            </v-card>
          </v-col>
        </v-row>
      </v-expansion-panel-text>
    </v-expansion-panel>
  </v-expansion-panels>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { CohortSummary } from '../../../shared/types/cohort'

// State
const summary = ref<CohortSummary>({
  total_cases: 0,
  total_variants: 0,
  unique_variants: 0,
  avg_variants_per_case: 0,
  genes_with_variants: 0
})
const loading = ref(false)
const expanded = ref<number[]>([]) // Empty array = collapsed by default

// Load summary data
const loadSummary = async (): Promise<void> => {
  // Guard for browser dev mode (no preload)
  // eslint-disable-next-line no-undef
  if (typeof window.api === 'undefined') {
    // eslint-disable-next-line no-undef
    console.warn('window.api not available - running outside Electron')
    return
  }

  loading.value = true
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-undef
    const result = await (window as any).api.cohort.getSummary()
    summary.value = result
  } catch (error) {
    // eslint-disable-next-line no-undef
    console.error('Failed to load cohort summary:', error)
  } finally {
    loading.value = false
  }
}

// Formatting functions
const formatNumber = (value: number): string => {
  return value.toLocaleString('en-US')
}

const formatDecimal = (value: number): string => {
  return value.toFixed(1)
}

// Refresh function (called by parent)
const refresh = async (): Promise<void> => {
  await loadSummary()
}

// Load on mount
onMounted(async () => {
  await loadSummary()
})

// Expose refresh method to parent
defineExpose({ refresh })
</script>
