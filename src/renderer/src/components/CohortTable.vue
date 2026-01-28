<template>
  <div>
    <v-data-table-server
      v-model:items-per-page="itemsPerPage"
      v-model:sort-by="sortBy"
      :headers="headers"
      :items="cohortVariants"
      :items-length="totalCount"
      :loading="loading"
      :items-per-page-options="[25, 50, 100]"
      item-value="variant_key"
      density="compact"
      class="elevation-1"
      @update:options="handleTableOptions"
    >
      <!-- Chromosome -->
      <template #[`item.chr`]="{ value }">
        <span>{{ value }}</span>
      </template>

      <!-- Position with thousand separators -->
      <template #[`item.pos`]="{ value }">
        <span class="genomic-coordinate">{{ formatPosition(value) }}</span>
      </template>

      <!-- Ref allele with truncation and tooltip -->
      <template #[`item.ref`]="{ value }">
        <v-tooltip v-if="value.length > 20" location="top">
          <template #activator="{ props: tooltipProps }">
            <span v-bind="tooltipProps" class="text-truncate allele-cell variant-data-mono">
              {{ value.substring(0, 20) }}...
            </span>
          </template>
          <span class="variant-data-mono">{{ value }}</span>
        </v-tooltip>
        <span v-else class="variant-data-mono">{{ value }}</span>
      </template>

      <!-- Alt allele with truncation and tooltip -->
      <template #[`item.alt`]="{ value }">
        <v-tooltip v-if="value.length > 20" location="top">
          <template #activator="{ props: tooltipProps }">
            <span v-bind="tooltipProps" class="text-truncate allele-cell variant-data-mono">
              {{ value.substring(0, 20) }}...
            </span>
          </template>
          <span class="variant-data-mono">{{ value }}</span>
        </v-tooltip>
        <span v-else class="variant-data-mono">{{ value }}</span>
      </template>

      <!-- Gene symbol -->
      <template #[`item.gene_symbol`]="{ value }">
        <span class="gene-symbol">{{ value ?? '--' }}</span>
      </template>

      <!-- Carrier count as chip with "N / total" format -->
      <template #[`item.carrier_count`]="{ item }">
        <v-chip size="small" color="primary" label>
          {{ item.carrier_count }} / {{ item.total_cases }}
        </v-chip>
      </template>

      <!-- Cohort frequency as percentage -->
      <template #[`item.cohort_frequency`]="{ value }">
        {{ formatPercentage(value) }}
      </template>

      <!-- Het / Hom combined column -->
      <template #[`item.het_count`]="{ item }">
        <span class="text-caption">
          <template v-if="item.hom_count > 0">
            {{ item.het_count }} het / {{ item.hom_count }} hom
          </template>
          <template v-else> {{ item.het_count }} het </template>
        </span>
      </template>
    </v-data-table-server>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { CohortVariant } from '../../../shared/types/cohort'

// Table state
const cohortVariants = ref<CohortVariant[]>([])
const totalCount = ref(0)
const loading = ref(false)
const itemsPerPage = ref(50)
const sortBy = ref<{ key: string; order: 'asc' | 'desc' }[]>([])

// Current query parameters
const currentParams = ref({
  sort_by: undefined as string | undefined,
  sort_order: 'desc' as 'asc' | 'desc',
  limit: 50,
  offset: 0
})

// Table headers
const headers = [
  { title: 'Chr', key: 'chr', sortable: true },
  { title: 'Position', key: 'pos', sortable: true, align: 'end' as const },
  { title: 'Ref', key: 'ref', sortable: false, width: '100px' },
  { title: 'Alt', key: 'alt', sortable: false, width: '100px' },
  { title: 'Gene', key: 'gene_symbol', sortable: true },
  { title: 'Carriers', key: 'carrier_count', sortable: true, align: 'end' as const },
  { title: 'Frequency', key: 'cohort_frequency', sortable: true, align: 'end' as const },
  { title: 'Het / Hom', key: 'het_count', sortable: true }
]

// Load cohort variants from backend
const loadCohortVariants = async (): Promise<void> => {
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
    const result = await (window as any).api.cohort.getVariants(currentParams.value)
    cohortVariants.value = result.data
    totalCount.value = result.total_count
  } catch (error) {
    // eslint-disable-next-line no-undef
    console.error('Failed to load cohort variants:', error)
    cohortVariants.value = []
    totalCount.value = 0
  } finally {
    loading.value = false
  }
}

// Handle table options update (pagination, sorting)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handleTableOptions = async (options: any): Promise<void> => {
  const { page, itemsPerPage: perPage, sortBy: newSortBy } = options

  // Update pagination
  currentParams.value.limit = perPage
  currentParams.value.offset = (page - 1) * perPage

  // Update sorting
  if (newSortBy !== undefined && newSortBy.length > 0) {
    currentParams.value.sort_by = newSortBy[0].key
    currentParams.value.sort_order = newSortBy[0].order
  } else {
    // Default sort when no user sort
    currentParams.value.sort_by = undefined
    currentParams.value.sort_order = 'desc'
  }

  await loadCohortVariants()
}

// Formatting functions
const formatPosition = (pos: number): string => {
  return new Intl.NumberFormat('en-US').format(pos)
}

const formatPercentage = (value: number): string => {
  return `${(value * 100).toFixed(1)}%`
}

// Refresh function (called by parent when switching tabs or after imports)
const refresh = async (): Promise<void> => {
  await loadCohortVariants()
}

// Load data on mount
onMounted(async () => {
  await loadCohortVariants()
})

// Expose refresh method to parent
defineExpose({ refresh })
</script>

<style scoped>
.text-truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.allele-cell {
  max-width: 120px;
  display: inline-block;
}

.genomic-coordinate {
  font-variant-numeric: tabular-nums;
}

.gene-symbol {
  font-weight: 500;
}

.variant-data-mono {
  font-family: 'Courier New', monospace;
  font-size: 0.85em;
}
</style>
