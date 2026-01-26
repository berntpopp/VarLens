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
  </v-data-table-server>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type {
  Variant,
  PaginationCursor,
  PaginatedResult,
  SortItem
} from '../../../shared/types/api'

interface Props {
  caseId: number
}

const props = defineProps<Props>()

// Table state - DO NOT mutate these in loadVariants handler (infinite loop)
const variants = ref<Variant[]>([])
const totalCount = ref(0)
const loading = ref(false)
const page = ref(1)
const itemsPerPage = ref(50)
const sortBy = ref<SortItem[]>([])

// Cursor cache for pagination - keyed by "page-sortKey-sortOrder"
const cursorCache = ref<Map<string, PaginationCursor>>(new Map())

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
  loading.value = true
  try {
    // Build cursor cache key from current sort state
    const sortKey = sortBy.value.length > 0 ? sortBy.value[0].key : 'default'
    const sortOrder = sortBy.value.length > 0 ? sortBy.value[0].order : 'asc'
    const cacheKey = `${page.value}-${sortKey}-${sortOrder}`

    // Get cursor for requested page (undefined for page 1)
    const cursor = page.value === 1 ? undefined : cursorCache.value.get(cacheKey)

    // Call IPC with sortBy parameter for backend sorting (Phase 06-02)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-undef
    const result: PaginatedResult<Variant> = await (window as any).api.variants.query(
      props.caseId,
      {}, // No filters in Phase 6
      cursor,
      itemsPerPage.value,
      sortBy.value
    )

    // Update display state (ONLY mutate these in handler, never page/itemsPerPage/sortBy)
    variants.value = result.data
    totalCount.value = result.total_count

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

// Clear cache when case changes
watch(
  () => props.caseId,
  () => {
    cursorCache.value.clear()
    page.value = 1
  }
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
</script>
