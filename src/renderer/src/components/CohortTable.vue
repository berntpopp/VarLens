<template>
  <div class="cohort-table-container">
    <!-- IPC Error Banner -->
    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      closable
      class="mb-4"
      @click:close="error = null"
    >
      <div class="d-flex align-center justify-space-between">
        <span>{{ error.message || 'Failed to load cohort data' }}</span>
        <v-btn variant="tonal" size="small" :prepend-icon="mdiRefresh" @click="handleRetry">
          Retry
        </v-btn>
      </div>
    </v-alert>

    <!-- Rebuild Indicator -->
    <v-banner
      v-if="summaryStale"
      density="compact"
      color="info"
      :icon="mdiDatabaseSync"
      class="mb-2"
    >
      Rebuilding cohort index...
    </v-banner>

    <!-- Filter Bar -->
    <CohortFilterBar
      ref="cohortFilterBarRef"
      :total-count="totalCount"
      :cohort-summary="summary"
      :columns="orderedColumns.map((h) => ({ key: h.key, title: h.title }))"
      :visible-columns="visibleHeaders.map((h) => h.key)"
      :exporting="exporting"
      :has-sort="hasSort"
      :column-active-filters="cohortDataTableRef?.columnActiveFilters ?? []"
      @filter-change="handleFilterChange"
      @clear-all="handleClearAll"
      @clear-filter="handleClearFilter"
      @clear-column-filter="handleClearColumnFilter"
      @clear-column-filters="handleClearColumnFilters"
      @export="handleExport"
      @toggle-column="toggleColumnVisibility"
      @reorder-columns="setColumnOrder"
      @reset-columns="resetToDefaults"
    />

    <!-- Data Table -->
    <CohortDataTable
      ref="cohortDataTableRef"
      v-model:page="page"
      v-model:items-per-page="itemsPerPage"
      v-model:sort-by="sortBy"
      :variants="variants"
      :total-count="totalCount"
      :loading="loading"
      :headers="visibleHeaders"
      :column-meta="columnMeta"
      :selected-variant-key="selectedVariantKey"
      :is-global-starred="isGlobalStarred"
      :get-global-acmg-classification="getGlobalAcmgClassification"
      :get-global-comment="getGlobalComment"
      @update:options="loadPage"
      @row-click="handleRowClick"
      @star-toggle="handleStarToggle"
      @acmg-select="handleAcmgSelect"
      @acmg-evidence-click="handleAcmgEvidenceClick"
      @comment-click="handleCommentClick"
      @navigate-to-case="handleNavigateToCase"
      @load-carriers="handleLoadCarriers"
      @column-filters-change="handleColumnFiltersChange"
      @deselect="emit('deselect')"
    />

    <!-- Annotation Dialogs (Comment, ACMG Evidence) -->
    <AnnotationDialogs
      ref="annotationDialogsRef"
      :case-id="null"
      annotation-scope="all"
      :annotation-actions="annotationActions"
    />

    <!-- Export Snackbar -->
    <v-snackbar
      v-model="snackbar.visible"
      :color="snackbar.color"
      :timeout="snackbar.timeout"
      location="bottom right"
    >
      {{ snackbar.message }}
      <template #actions>
        <v-btn v-if="snackbar.actionText" variant="text" @click="snackbar.actionCallback?.()">
          {{ snackbar.actionText }}
        </v-btn>
        <v-btn variant="text" @click="snackbar.visible = false">Close</v-btn>
      </template>
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
// Composables
import { useOffsetPagination } from '../composables/useOffsetPagination'
import { useCohortData } from '../composables/useCohortData'
import { useFilters } from '../composables/useFilters'
import { useCarriers } from '../composables/useCarriers'
import { useAnnotations } from '../composables/useAnnotations'
import { useColumnPreferences } from '../composables/useColumnPreferences'
import { useApiService } from '../composables/useApiService'
import { logService } from '../services/LogService'
import { useDebounce } from '../composables/useDebounce'
// Sub-components
import CohortFilterBar from './cohort/CohortFilterBar.vue'
import CohortDataTable from './cohort/CohortDataTable.vue'
import AnnotationDialogs from './AnnotationDialogs.vue'
// Column composable
import { useCohortColumns } from './cohort/useCohortColumns'
// Types
import type { CohortVariant } from '../../../shared/types/cohort'
import type { CohortQueryParams } from '../composables/useCohortData'
import type { ColumnFiltersParam } from '../../../shared/types/column-filters'
import { mdiDatabaseSync, mdiRefresh } from '@mdi/js'

// Emit for navigation and row click
const emit = defineEmits<{
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

// API + domain composables
const { api } = useApiService()
const {
  summary,
  summaryStale,
  columnMeta,
  fetchSummary,
  fetchColumnMeta,
  buildIpcParams,
  cleanupListeners
} = useCohortData()
const { filters, searchTerm, selectedImpactPresets, clearAllFilters, clearFilter } = useFilters()
const { loadCarriers } = useCarriers()
const {
  isGlobalStarred,
  getGlobalAcmgClassification,
  getGlobalAcmgEvidence,
  getGlobalComment,
  loadGlobalAnnotationsBatch,
  toggleGlobalStar,
  setGlobalAcmgClassification,
  setGlobalAcmgClassificationWithEvidence,
  upsertGlobalComment,
  getAnnotations
} = useAnnotations()
const { prefs, resetToDefaults, toggleColumnVisibility, setColumnOrder } =
  useColumnPreferences('cohort-table')
const { orderedColumns, visibleHeaders } = useCohortColumns(prefs)

// Ref to CohortFilterBar for accessing DSL column filters
const cohortFilterBarRef = ref<InstanceType<typeof CohortFilterBar> | null>(null)

// Per-column text filters from CohortDataTable
const cohortColumnFilters = ref<ColumnFiltersParam | undefined>(undefined)

// Sort state for filter bar
const hasSort = ref(false)

// Build cohort query params from current filter state
const buildCohortQueryParams = (): Omit<
  CohortQueryParams,
  'limit' | 'offset' | 'sort_by' | 'sort_order'
> => ({
  search_term: searchTerm.value || undefined,
  gene_symbol: filters.value.geneSymbol || undefined,
  consequences: selectedImpactPresets.value.length > 0 ? selectedImpactPresets.value : undefined,
  funcs: filters.value.funcs.length > 0 ? filters.value.funcs : undefined,
  clinvars: filters.value.clinvars.length > 0 ? filters.value.clinvars : undefined,
  gnomad_af_max: filters.value.maxGnomadAf ?? undefined,
  cadd_min: filters.value.minCadd ?? undefined,
  cohort_frequency_min: filters.value.minCohortFrequency ?? undefined,
  starred_only: filters.value.starredOnly || undefined,
  has_comment: filters.value.hasCommentOnly || undefined,
  acmg_classifications:
    filters.value.acmgClassifications.length > 0
      ? [...filters.value.acmgClassifications]
      : undefined,
  column_filters:
    cohortColumnFilters.value != null ||
    Object.keys(cohortFilterBarRef.value?.dslColumnFilters ?? {}).length > 0
      ? {
          ...(cohortColumnFilters.value ?? {}),
          ...(cohortFilterBarRef.value?.dslColumnFilters ?? {})
        }
      : undefined,
  active_panel_ids:
    filters.value.activePanelIds.length > 0 ? [...filters.value.activePanelIds] : undefined,
  panel_padding_bp:
    filters.value.activePanelIds.length > 0 ? filters.value.panelPaddingBp : undefined
})

// Shared offset pagination (same composable as case view)
const {
  page,
  itemsPerPage,
  sortBy,
  items: variants,
  totalCount,
  loading,
  error,
  loadPage,
  invalidateAndReload,
  resetSort
} = useOffsetPagination<CohortVariant>({
  fetchPage: async ({ offset, limit, sortBy: sortItems }) => {
    if (!api) {
      return { data: [], total_count: 0 }
    }

    const sortKey = sortItems.length > 0 ? sortItems[0].key : undefined
    const sortOrder: 'asc' | 'desc' = sortItems.length > 0 ? sortItems[0].order : 'desc'

    const params: CohortQueryParams = {
      limit,
      offset,
      sort_by: sortKey,
      sort_order: sortOrder,
      ...buildCohortQueryParams()
    }

    const plainParams = buildIpcParams(params)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (api as any).cohort.getVariants(plainParams)

    return {
      data: result.data ?? [],
      total_count: result.total_count ?? 0
    }
  },
  onSortChange: (sorted) => {
    hasSort.value = sorted
  }
})

// Local state
const selectedVariantKey = ref<string | null>(null)
const annotationDialogsRef = ref<InstanceType<typeof AnnotationDialogs> | null>(null)
const cohortDataTableRef = ref<InstanceType<typeof CohortDataTable> | null>(null)

// Export state
const exporting = ref(false)
const snackbar = ref({
  visible: false,
  message: '',
  color: 'success' as 'success' | 'error',
  timeout: 3000,
  actionText: null as string | null,
  actionCallback: null as (() => void) | null
})

const exportToExcel = async (): Promise<void> => {
  if (!api) {
    logService.warn('API not available - running outside Electron', 'cohort')
    return
  }

  exporting.value = true
  try {
    const plainParams = {
      search_term: searchTerm.value || undefined,
      gene_symbol: filters.value.geneSymbol || undefined,
      consequences:
        selectedImpactPresets.value.length > 0 ? [...selectedImpactPresets.value] : undefined,
      funcs: filters.value.funcs.length > 0 ? [...filters.value.funcs] : undefined,
      clinvars: filters.value.clinvars.length > 0 ? [...filters.value.clinvars] : undefined,
      gnomad_af_max: filters.value.maxGnomadAf ?? undefined,
      cadd_min: filters.value.minCadd ?? undefined,
      cohort_frequency_min: filters.value.minCohortFrequency ?? undefined
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (api as any).export.cohort(plainParams)

    if (result !== null && result !== undefined && 'code' in result) {
      snackbar.value = {
        visible: true,
        message: `Export failed: ${result.message ?? result.userMessage ?? 'Unknown error'}`,
        color: 'error',
        timeout: -1,
        actionText: null,
        actionCallback: null
      }
    } else if (result !== null && result !== undefined && result.success === true) {
      snackbar.value = {
        visible: true,
        message: `Exported to ${result.filePath}`,
        color: 'success',
        timeout: 3000,
        actionText: 'Open folder',
        actionCallback: () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(api as any).shell.showItemInFolder(result.filePath)
        }
      }
    }
  } finally {
    exporting.value = false
  }
}

// Annotation actions passed to AnnotationDialogs
const annotationActions = {
  // Per-case stubs (not used in cohort mode, but required by interface)
  getAcmgEvidence: getGlobalAcmgEvidence,
  toggleStar: async () => {},
  setAcmgClassification: async () => {},
  setAcmgClassificationWithEvidence: async () => {},
  upsertPerCaseComment: async () => {},
  // Shared
  upsertGlobalComment,
  getAnnotations,
  getGlobalComment,
  getPerCaseComment: () => null,
  // Global methods
  toggleGlobalStar,
  setGlobalAcmgClassification,
  setGlobalAcmgClassificationWithEvidence,
  getGlobalAcmgEvidence
}

// Event handlers
const handleFilterChange = () => invalidateAndReload()

const handleClearAll = async () => {
  clearAllFilters()
  cohortDataTableRef.value?.clearAllColumnFilters()
  resetSort()
  await invalidateAndReload()
}

const handleClearFilter = async (filterId: string) => {
  clearFilter(filterId)
  await invalidateAndReload()
}

const handleRowClick = (variant: CohortVariant) => {
  selectedVariantKey.value = variant.variant_key
  emit('row-click', variant)
}

// Debounced reload when per-column filters change
const { debouncedFn: debouncedColumnFilterReload } = useDebounce(invalidateAndReload, 300)

const handleColumnFiltersChange = (newFilters: ColumnFiltersParam | undefined): void => {
  cohortColumnFilters.value = newFilters
  debouncedColumnFilterReload()
}

const handleClearColumnFilter = (columnKey: string): void => {
  cohortDataTableRef.value?.clearColumnFilter(columnKey)
}

const handleClearColumnFilters = (): void => {
  cohortDataTableRef.value?.clearAllColumnFilters()
}

const handleRetry = async () => {
  error.value = null
  await invalidateAndReload()
}

// Delegate annotation events to AnnotationDialogs
const handleStarToggle = (item: CohortVariant) => {
  annotationDialogsRef.value?.handleStarToggle(item)
}

const handleAcmgSelect = (payload: {
  item: CohortVariant
  classification: import('../../../main/database/types').AcmgClassification | null
}) => {
  annotationDialogsRef.value?.handleQuickAcmgSelect(payload.item, payload.classification)
}

const handleAcmgEvidenceClick = (item: CohortVariant) => {
  annotationDialogsRef.value?.openAcmgEvidenceDialog(item)
}

const handleCommentClick = (item: CohortVariant) => {
  annotationDialogsRef.value?.openCommentDialog(item)
}

const handleExport = () => {
  exportToExcel()
}

const handleNavigateToCase = (payload: { caseId: number; item: CohortVariant }) => {
  emit('navigate-to-case', {
    caseId: payload.caseId,
    chr: payload.item.chr,
    pos: payload.item.pos,
    ref: payload.item.ref,
    alt: payload.item.alt,
    geneSymbol: payload.item.gene_symbol,
    cdna: payload.item.cdna
  })
}

const handleLoadCarriers = async (variant: CohortVariant) => {
  await loadCarriers(variant)
}

// Watch variants and load annotations (debounced to prevent overlapping
// IPC calls during rapid page changes)
const { debouncedFn: debouncedLoadAnnotations } = useDebounce(
  async (newVariants: CohortVariant[]) => {
    if (newVariants.length > 0) {
      await loadGlobalAnnotationsBatch(
        newVariants.map((v) => ({ chr: v.chr, pos: v.pos, ref: v.ref, alt: v.alt }))
      )
    }
  },
  150
)
watch(variants, (newVariants) => {
  debouncedLoadAnnotations(newVariants)
})

// Auto-refresh when summary rebuild completes
watch(summaryStale, (newVal, oldVal) => {
  if (oldVal === true && newVal === false) {
    // Summary rebuilt — refresh current page and metadata
    void invalidateAndReload()
    void fetchSummary()
    void fetchColumnMeta()
  }
})

// Lifecycle — no data fetching on mount; parent controls initialization
// via refresh() to avoid duplicate IPC calls (onMounted + parent refresh).
onUnmounted(() => {
  cleanupListeners()
})

// Expose refresh method — single entry point for all data loading
const refresh = async () => {
  void fetchSummary()
  void fetchColumnMeta()
  await invalidateAndReload()
}
defineExpose({ refresh })
</script>

<style scoped>
/* CohortTable fills remaining height in flex parent.
   height: 100% is needed because the parent v-tabs-window-item is display: block,
   so flex: 1 alone has no effect. */
.cohort-table-container {
  display: flex;
  flex-direction: column;
  flex: 1;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

/* Prevent banners/alerts from growing — only the data table gets remaining space */
.cohort-table-container > .v-alert,
.cohort-table-container > .v-banner {
  flex-shrink: 0;
}
</style>
