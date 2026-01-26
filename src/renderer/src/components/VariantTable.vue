<template>
  <v-data-table-server
    v-model:page="page"
    v-model:items-per-page="itemsPerPage"
    v-model:sort-by="sortBy"
    :headers="headers"
    :items="variants"
    :items-length="totalCount"
    :loading="loading"
    :items-per-page-options="[25, 50, 100]"
    density="compact"
    multi-sort
    class="elevation-1"
    @update:options="loadVariants"
  >
    <!-- Position with thousand separators -->
    <template #[`item.pos`]="{ value }">
      {{ formatPosition(value) }}
    </template>

    <!-- gnomAD AF in scientific notation -->
    <template #[`item.gnomad_af`]="{ value }">
      {{ formatScientific(value) }}
    </template>

    <!-- ClinVar colored chips -->
    <template #[`item.clinvar`]="{ value }">
      <v-chip v-if="value" :color="getClinVarColor(value)" size="small" label>
        {{ value.replace(/_/g, ' ') }}
      </v-chip>
      <span v-else class="text-grey">-</span>
    </template>

    <!-- Ref allele with truncation and tooltip -->
    <template #[`item.ref`]="{ value }">
      <v-tooltip v-if="value.length > 20" location="top">
        <template #activator="{ props: tooltipProps }">
          <span v-bind="tooltipProps" class="text-truncate allele-cell">
            {{ value.substring(0, 20) }}...
          </span>
        </template>
        <span class="font-mono">{{ value }}</span>
      </v-tooltip>
      <span v-else class="font-mono">{{ value }}</span>
    </template>

    <!-- Alt allele with truncation and tooltip -->
    <template #[`item.alt`]="{ value }">
      <v-tooltip v-if="value.length > 20" location="top">
        <template #activator="{ props: tooltipProps }">
          <span v-bind="tooltipProps" class="text-truncate allele-cell">
            {{ value.substring(0, 20) }}...
          </span>
        </template>
        <span class="font-mono">{{ value }}</span>
      </v-tooltip>
      <span v-else class="font-mono">{{ value }}</span>
    </template>

    <!-- CADD score (handle null) -->
    <template #[`item.cadd`]="{ value }">
      {{ value !== null ? value.toFixed(1) : '-' }}
    </template>

    <!-- Gene symbol (handle null) -->
    <template #[`item.gene_symbol`]="{ value }">
      {{ value ?? '-' }}
    </template>

    <!-- Consequence (handle null) -->
    <template #[`item.consequence`]="{ value }">
      {{ (value ?? null) !== null ? value.replace(/_/g, ' ') : '-' }}
    </template>
  </v-data-table-server>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type {
  Variant,
  VariantFilter,
  PaginationCursor,
  PaginatedResult,
  SortItem
} from '../../../shared/types/api'

interface Props {
  caseId: number
  filters: Omit<VariantFilter, 'case_id'>
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:counts': [counts: { filtered: number; total: number }]
}>()

// Table state - DO NOT mutate these in loadVariants handler (infinite loop)
const variants = ref<Variant[]>([])
const totalCount = ref(0)
const loading = ref(false)
const page = ref(1)
const itemsPerPage = ref(50)
const sortBy = ref<SortItem[]>([])

// Cursor cache for pagination - keyed by "page-sortKey-sortOrder"
const cursorCache = ref<Map<string, PaginationCursor>>(new Map())

// Track unfiltered count for "X of Y" display
const unfilteredCount = ref(0)

// Headers definition
const headers = [
  { title: 'Chr', key: 'chr', sortable: true },
  { title: 'Position', key: 'pos', sortable: true, align: 'end' as const },
  { title: 'Ref', key: 'ref', sortable: false, width: '120px' },
  { title: 'Alt', key: 'alt', sortable: false, width: '120px' },
  { title: 'Gene', key: 'gene_symbol', sortable: true },
  { title: 'Consequence', key: 'consequence', sortable: true },
  { title: 'gnomAD AF', key: 'gnomad_af', sortable: true, align: 'end' as const },
  { title: 'CADD', key: 'cadd', sortable: true, align: 'end' as const },
  { title: 'ClinVar', key: 'clinvar', sortable: true }
]

// Load variants from backend
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loadVariants = async (_options?: any): Promise<void> => {
  // Guard for browser dev mode (no preload)
  // eslint-disable-next-line no-undef
  if (typeof window.api === 'undefined') {
    // eslint-disable-next-line no-undef
    console.warn('window.api not available - running outside Electron')
    return
  }

  loading.value = true
  try {
    // Build cursor cache key from current sort state
    const sortKey = sortBy.value.length > 0 ? sortBy.value[0].key : 'default'
    const sortOrder = sortBy.value.length > 0 ? sortBy.value[0].order : 'asc'
    const cacheKey = `${page.value}-${sortKey}-${sortOrder}`

    // Get cursor for requested page (undefined for page 1)
    const cursor = page.value === 1 ? undefined : cursorCache.value.get(cacheKey)

    // Call IPC with filters and sortBy parameters
    // Convert reactive proxies to plain objects for IPC serialization
    const plainFilters = JSON.parse(JSON.stringify(props.filters))
    const plainSortBy = JSON.parse(JSON.stringify(sortBy.value))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-undef
    const result: PaginatedResult<Variant> = await (window as any).api.variants.query(
      props.caseId,
      plainFilters,
      cursor,
      itemsPerPage.value,
      plainSortBy
    )

    // Update display state (ONLY mutate these in handler, never page/itemsPerPage/sortBy)
    variants.value = result.data
    totalCount.value = result.total_count

    // Emit counts to parent for toolbar display
    emit('update:counts', {
      filtered: result.total_count,
      total: unfilteredCount.value
    })

    // Cache next cursor if more results available
    if ((result.next_cursor ?? null) !== null && result.has_more) {
      const nextCacheKey = `${page.value + 1}-${sortKey}-${sortOrder}`

      cursorCache.value.set(nextCacheKey, result.next_cursor!)
    }
  } catch (error) {
    // eslint-disable-next-line no-undef
    console.error('Failed to load variants:', error)
    variants.value = []
    totalCount.value = 0
  } finally {
    loading.value = false
  }
}

// Fetch unfiltered count on case change
watch(
  () => props.caseId,
  async (newCaseId) => {
    if (newCaseId) {
      // Clear cache and reset pagination
      cursorCache.value.clear()
      page.value = 1

      // Fetch unfiltered count (query with empty filters)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-undef
      const result = await (window as any).api.variants.query(newCaseId, {}, undefined, 1, [])
      unfilteredCount.value = result.total_count
    }
  },
  { immediate: true }
)

// Clear cache when sort changes (sort change invalidates all cursors)
watch(
  sortBy,
  () => {
    cursorCache.value.clear()
    page.value = 1
  },
  { deep: true }
)

// Clear cache and reload when filters change (CRITICAL per RESEARCH.md Pitfall 2)
watch(
  () => props.filters,
  async () => {
    cursorCache.value.clear()
    page.value = 1
    // Explicitly call loadVariants - page change alone won't trigger if already on page 1
    await loadVariants()
  },
  { deep: true }
)

// Formatting functions
const formatPosition = (pos: number): string => {
  return new Intl.NumberFormat('en-US').format(pos)
}

const formatScientific = (value: number | null): string => {
  if (value === null) return '-'
  if (value < 0.001 && value > 0) {
    return new Intl.NumberFormat('en-US', {
      notation: 'scientific',
      maximumFractionDigits: 1
    }).format(value)
  }
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 4
  }).format(value)
}

const getClinVarColor = (significance: string | null): string => {
  if ((significance ?? null) === null) return 'grey'
  // After null check, significance is guaranteed to be string
  const sig = significance as string
  const colorMap: Record<string, string> = {
    Pathogenic: 'red',
    Likely_pathogenic: 'red-lighten-1',
    Uncertain_significance: 'amber',
    Likely_benign: 'green-lighten-1',
    Benign: 'green'
  }
  return (colorMap[sig] ?? null) !== null ? colorMap[sig] : 'grey'
}
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

.font-mono {
  font-family: monospace;
}
</style>
