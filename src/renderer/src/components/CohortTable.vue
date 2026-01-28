<template>
  <div>
    <!-- Search bar -->
    <v-text-field
      v-model="searchTerm"
      prepend-inner-icon="mdi-magnify"
      placeholder="Search by gene, position (chr:pos), or HGVS notation..."
      clearable
      density="compact"
      variant="outlined"
      hide-details
      class="mb-3"
      @update:model-value="handleSearchChange"
    />

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
      show-expand
      class="elevation-1"
      @update:options="handleTableOptions"
      @update:expanded="handleExpanded"
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

      <!-- Expandable row with carrier details -->
      <template #expanded-row="{ columns, item }">
        <tr>
          <td :colspan="columns.length" class="pa-0">
            <v-table density="compact" class="nested-carriers-table bg-surface-variant">
              <thead>
                <tr>
                  <th class="text-left">Case</th>
                  <th class="text-left">Zygosity</th>
                  <th class="text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="carrier in carrierMap.get(item.variant_key)" :key="carrier.case_id">
                  <td>{{ carrier.case_name }}</td>
                  <td>
                    <v-chip
                      size="x-small"
                      :color="isHomozygous(carrier.gt_num) ? 'error' : 'warning'"
                      label
                    >
                      {{ formatZygosity(carrier.gt_num) }}
                    </v-chip>
                  </td>
                  <td>
                    <v-btn
                      size="small"
                      variant="text"
                      prepend-icon="mdi-open-in-app"
                      @click="handleNavigateToCase(carrier.case_id, item)"
                    >
                      View in Case
                    </v-btn>
                  </td>
                </tr>
              </tbody>
            </v-table>
          </td>
        </tr>
      </template>
    </v-data-table-server>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { CohortVariant, CohortCarrier } from '../../../shared/types/cohort'

// Emit for navigation
const emit = defineEmits<{
  'navigate-to-case': [
    payload: { caseId: number; chr: string; pos: number; ref: string; alt: string }
  ]
}>()

// Table state
const cohortVariants = ref<CohortVariant[]>([])
const totalCount = ref(0)
const loading = ref(false)
const itemsPerPage = ref(50)
const sortBy = ref<{ key: string; order: 'asc' | 'desc' }[]>([])

// Search state
const searchTerm = ref('')
// eslint-disable-next-line no-undef
let searchDebounceTimeout: ReturnType<typeof setTimeout> | null = null

// Carrier state (lazy-loaded per variant)
const carrierMap = ref<Map<string, CohortCarrier[]>>(new Map())

// Current query parameters
const currentParams = ref({
  search_term: undefined as string | undefined,
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

// Handle search change with debounce
const handleSearchChange = (value: string | null): void => {
  // Clear existing timeout
  if (searchDebounceTimeout !== null) {
    // eslint-disable-next-line no-undef
    clearTimeout(searchDebounceTimeout)
  }

  // Set new timeout for 300ms debounce
  // eslint-disable-next-line no-undef
  searchDebounceTimeout = setTimeout(() => {
    currentParams.value.search_term = value == null || value === '' ? undefined : value
    currentParams.value.offset = 0 // Reset to first page on search
    void loadCohortVariants()
  }, 300)
}

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

// Handle row expansion - lazy load carriers
const handleExpanded = async (value: { value: boolean; item: CohortVariant }[]): Promise<void> => {
  // Find newly expanded rows
  for (const { value: isExpanded, item } of value) {
    if (isExpanded && !carrierMap.value.has(item.variant_key)) {
      // Lazy load carriers for this variant
      await loadCarriers(item)
    }
  }
}

// Load carriers for a specific variant
const loadCarriers = async (variant: CohortVariant): Promise<void> => {
  // Guard for browser dev mode (no preload)
  // eslint-disable-next-line no-undef
  if (typeof window.api === 'undefined') {
    return
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-undef
    const carriers = await (window as any).api.cohort.getCarriers(
      variant.chr,
      variant.pos,
      variant.ref,
      variant.alt
    )
    carrierMap.value.set(variant.variant_key, carriers)
  } catch (error) {
    // eslint-disable-next-line no-undef
    console.error('Failed to load carriers:', error)
    carrierMap.value.set(variant.variant_key, [])
  }
}

// Zygosity helper functions
const isHomozygous = (gt: string): boolean => {
  return gt.includes('1/1') || gt.includes('1|1')
}

const formatZygosity = (gt: string): string => {
  return isHomozygous(gt) ? 'hom' : 'het'
}

// Handle navigation to case
const handleNavigateToCase = (caseId: number, variant: CohortVariant): void => {
  emit('navigate-to-case', {
    caseId,
    chr: variant.chr,
    pos: variant.pos,
    ref: variant.ref,
    alt: variant.alt
  })
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
