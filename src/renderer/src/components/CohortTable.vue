<template>
  <div class="cohort-table-container">
    <!-- IPC Error Banner (SOL-11) -->
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
        <v-btn variant="tonal" size="small" prepend-icon="mdi-refresh" @click="handleRetry">
          Retry
        </v-btn>
      </div>
    </v-alert>

    <!-- Filter Bar -->
    <CohortFilterBar
      :total-count="totalCount"
      :cohort-summary="summary"
      :columns="orderedColumns.map((h) => ({ key: h.key, title: h.title }))"
      :visible-columns="visibleHeaders.map((h) => h.key)"
      :exporting="exporting"
      @filter-change="handleFilterChange"
      @clear-all="handleClearAll"
      @clear-filter="handleClearFilter"
      @export="exportToExcel"
      @toggle-column="toggleColumnVisibility"
      @reorder-columns="setColumnOrder"
      @reset-columns="resetToDefaults"
    />

    <!-- Data Table -->
    <CohortDataTable
      ref="dataTableRef"
      :variants="variants"
      :total-count="totalCount ?? 0"
      :loading="isLoading"
      :headers="visibleHeaders"
      :page="currentPage"
      :selected-variant-key="selectedVariantKey"
      :is-global-starred="isGlobalStarred"
      :get-global-acmg-classification="getGlobalAcmgClassification"
      :get-global-comment="getGlobalComment"
      @update:options="handleTableOptions"
      @row-click="handleRowClick"
      @star-toggle="handleGlobalStarToggle"
      @acmg-select="handleGlobalAcmgSelect"
      @acmg-evidence-click="openAcmgEvidenceDialog"
      @comment-click="openCommentDialog"
      @navigate-to-case="handleNavigateToCase"
      @load-carriers="handleLoadCarriers"
      @column-filters-change="handleColumnFiltersChange"
    />

    <!-- Comment Dialog -->
    <CommentDialog
      v-model="commentDialogOpen"
      :global-comment="selectedVariantComment"
      :per-case-comment="null"
      :global-timestamps="selectedVariantTimestamps"
      :per-case-timestamps="null"
      @save="handleCommentSave"
    />

    <!-- ACMG Evidence Dialog -->
    <AcmgEvidenceDialog
      ref="acmgEvidenceDialogRef"
      :evidence-json="acmgEvidenceJson"
      :variant-data="acmgVariantData"
      :variant-label="acmgVariantLabel"
      :variant-cdna="selectedVariantForAcmg?.cdna ?? null"
      :variant-aa-change="selectedVariantForAcmg?.aa_change ?? null"
      @change="handleAcmgEvidenceChange"
    />

    <!-- Success Snackbar -->
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
import { ref, watch, computed, onMounted, nextTick } from 'vue'
// Composables
import { useCohortData } from '../composables/useCohortData'
import { useFilters } from '../composables/useFilters'
import { useCarriers } from '../composables/useCarriers'
import { useAnnotations } from '../composables/useAnnotations'
import { useColumnPreferences } from '../composables/useColumnPreferences'
import { useApiService } from '../composables/useApiService'
// Sub-components
import CohortFilterBar from './cohort/CohortFilterBar.vue'
import CohortDataTable from './cohort/CohortDataTable.vue'
import CommentDialog from './CommentDialog.vue'
import AcmgEvidenceDialog from './AcmgEvidenceDialog.vue'
// Types
import type { CohortVariant, CohortPaginationCursor } from '../../../shared/types/cohort'
import type { AcmgClassification } from '../../../main/database/types'

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
}>()

// Composables
const { api } = useApiService()
const { variants, totalCount, isLoading, error, summary, nextCursor, fetchVariants, fetchSummary } =
  useCohortData()

// Cursor tracking: page number -> cursor to use for that page
// Page 1 has no cursor (first page), page 2 uses cursor from page 1, etc.
const pageCursors = ref<Map<number, CohortPaginationCursor>>(new Map())
const currentPage = ref(1)
const currentSortBy = ref<string | undefined>(undefined)
const currentSortOrder = ref<'asc' | 'desc'>('desc')
const currentItemsPerPage = ref(50)
// useFilters is a singleton - CohortFilterBar and CohortTable share the same state
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

// Per-column text filters from CohortDataTable
const cohortColumnFilters = ref<Record<string, string> | undefined>(undefined)

// Local state
// dataTableRef is used in template via ref="dataTableRef"
// @ts-expect-error - ref is used in template
const dataTableRef = ref()
const selectedVariantKey = ref<string | null>(null)
const commentDialogOpen = ref(false)
const selectedVariantForComment = ref<CohortVariant | null>(null)

// ACMG evidence dialog state
const acmgEvidenceDialogRef = ref<InstanceType<typeof AcmgEvidenceDialog> | null>(null)
const selectedVariantForAcmg = ref<CohortVariant | null>(null)

const acmgEvidenceJson = computed(() => {
  const v = selectedVariantForAcmg.value
  if (v === null) return null
  return getGlobalAcmgEvidence(v.chr, v.pos, v.ref, v.alt)
})

const acmgVariantData = computed(() => {
  const v = selectedVariantForAcmg.value
  if (v === null) return null
  return {
    gnomad_af: v.gnomad_af ?? null,
    cadd: v.cadd_phred ?? null,
    clinvar: v.clinvar ?? null
  }
})

const acmgVariantLabel = computed(() => {
  const v = selectedVariantForAcmg.value
  if (v === null) return ''
  return `${v.chr}:${v.pos} ${v.ref}>${v.alt}${v.gene_symbol !== null ? ` (${v.gene_symbol})` : ''}`
})

const exporting = ref(false)
const snackbar = ref({
  visible: false,
  message: '',
  color: 'success' as 'success' | 'error',
  timeout: 3000,
  actionText: null as string | null,
  actionCallback: null as (() => void) | null
})

// Base headers definition - matching Case Analysis columns where applicable
// Note: 'data-table-expand' header puts expand button on left side
const baseHeaders = [
  { title: '', key: 'data-table-expand', sortable: false, width: '40px' },
  { title: '', key: 'annotations', sortable: false, width: '100px', align: 'center' as const },
  { title: 'Chr', key: 'chr', sortable: true },
  { title: 'Position', key: 'pos', sortable: true, align: 'end' as const },
  { title: 'Ref', key: 'ref', sortable: false, width: '80px' },
  { title: 'Alt', key: 'alt', sortable: false, width: '80px' },
  { title: 'Gene', key: 'gene_symbol', sortable: true },
  { title: 'Transcript', key: 'transcript', sortable: true },
  { title: 'cDNA', key: 'cdna', sortable: true },
  { title: 'AA Change', key: 'aa_change', sortable: true },
  { title: 'Consequence', key: 'consequence', sortable: true },
  { title: 'Func', key: 'func', sortable: true },
  { title: 'ClinVar', key: 'clinvar', sortable: true },
  { title: 'gnomAD AF', key: 'gnomad_af', sortable: true, align: 'end' as const },
  { title: 'CADD', key: 'cadd_phred', sortable: true, align: 'end' as const },
  { title: 'Carriers', key: 'carrier_count', sortable: true, align: 'end' as const },
  { title: 'Cohort Freq', key: 'cohort_frequency', sortable: true, align: 'end' as const },
  { title: 'Het / Hom', key: 'het_count', sortable: true }
]

// Ordered columns based on user preferences
const orderedColumns = computed(() => {
  if (prefs.value.order.length > 0) {
    return [...baseHeaders].sort((a, b) => {
      const aIdx = prefs.value.order.indexOf(a.key)
      const bIdx = prefs.value.order.indexOf(b.key)
      if (aIdx === -1 && bIdx === -1) return 0
      if (aIdx === -1) return 1
      if (bIdx === -1) return -1
      return aIdx - bIdx
    })
  }
  return baseHeaders
})

// Visible headers based on user preferences
const visibleHeaders = computed(() => {
  return orderedColumns.value.filter((h) => prefs.value.visibility[h.key] !== false)
})

// Computed properties for comment dialog
const selectedVariantComment = computed(() => {
  if (!selectedVariantForComment.value) return null
  return getGlobalComment(
    selectedVariantForComment.value.chr,
    selectedVariantForComment.value.pos,
    selectedVariantForComment.value.ref,
    selectedVariantForComment.value.alt
  )
})

const selectedVariantTimestamps = computed(() => {
  if (!selectedVariantForComment.value) return null
  const annotations = getAnnotations(
    selectedVariantForComment.value.chr,
    selectedVariantForComment.value.pos,
    selectedVariantForComment.value.ref,
    selectedVariantForComment.value.alt
  )
  if (!annotations?.global) return null
  return { created_at: annotations.global.created_at, updated_at: annotations.global.updated_at }
})

// Build query params from filter state
// NOTE: buildQueryParams is temporary scaffolding. Phase 28 (DRY-07, DRY-09) will
// introduce shared filter serialization utilities that this function should use.
// For now, implement inline to maintain Phase 29's independence from Phase 28.
const buildQueryParams = (cursor?: CohortPaginationCursor) => ({
  limit: 50,
  cursor,
  sort_order: (currentSortOrder.value ?? 'desc') as 'asc' | 'desc',
  sort_by: currentSortBy.value,
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
  column_filters: cohortColumnFilters.value
})

// Event handlers
const handleFilterChange = async () => {
  pageCursors.value.clear()
  currentPage.value = 1
  await fetchVariants(buildQueryParams())
}

const handleClearAll = async () => {
  clearAllFilters()
  pageCursors.value.clear()
  currentPage.value = 1
  await fetchVariants(buildQueryParams())
}

const handleClearFilter = async (filterId: string) => {
  clearFilter(filterId)
  pageCursors.value.clear()
  currentPage.value = 1
  await fetchVariants(buildQueryParams())
}

const handleTableOptions = async (options: {
  page: number
  itemsPerPage: number
  sortBy: Array<{ key: string; order: 'asc' | 'desc' }>
}) => {
  const newSortBy = options.sortBy.length > 0 ? options.sortBy[0].key : undefined
  const newSortOrder = (options.sortBy.length > 0 ? options.sortBy[0].order : 'desc') as
    | 'asc'
    | 'desc'

  // Reset cursors if sort or page size changed
  const sortChanged = newSortBy !== currentSortBy.value || newSortOrder !== currentSortOrder.value
  const pageSizeChanged = options.itemsPerPage !== currentItemsPerPage.value
  if (sortChanged || pageSizeChanged) {
    pageCursors.value.clear()
    currentPage.value = 1
  }
  currentSortBy.value = newSortBy
  currentSortOrder.value = newSortOrder
  currentItemsPerPage.value = options.itemsPerPage

  // Determine effective page (reset to 1 if cursor not available for requested page)
  let effectivePage = sortChanged || pageSizeChanged ? 1 : options.page
  let cursor: CohortPaginationCursor | undefined
  if (effectivePage > 1) {
    cursor = pageCursors.value.get(effectivePage)
    if (cursor === undefined) {
      // No cached cursor for this page — reset to page 1
      effectivePage = 1
    }
  }

  const baseParams = buildQueryParams(cursor)
  const params = {
    ...baseParams,
    limit: options.itemsPerPage,
    sort_by: newSortBy,
    sort_order: newSortOrder
  }

  await fetchVariants(params)
  currentPage.value = effectivePage

  // Store cursor for next page
  if (nextCursor.value) {
    pageCursors.value.set(options.page + 1, nextCursor.value)
  }
}

const handleRowClick = (variant: CohortVariant) => {
  selectedVariantKey.value = variant.variant_key
  emit('row-click', variant)
}

const handleColumnFiltersChange = async (
  filters: Record<string, string> | undefined
): Promise<void> => {
  cohortColumnFilters.value = filters
  pageCursors.value.clear()
  currentPage.value = 1
  await fetchVariants(buildQueryParams())
}

const handleRetry = async () => {
  error.value = null
  pageCursors.value.clear()
  currentPage.value = 1
  await fetchVariants(buildQueryParams())
}

const handleGlobalStarToggle = async (item: CohortVariant) => {
  await toggleGlobalStar(item.chr, item.pos, item.ref, item.alt)
}

const handleGlobalAcmgSelect = async (payload: {
  item: CohortVariant
  classification: AcmgClassification | null
}) => {
  await setGlobalAcmgClassification(
    payload.item.chr,
    payload.item.pos,
    payload.item.ref,
    payload.item.alt,
    payload.classification
  )
}

const openAcmgEvidenceDialog = (item: CohortVariant): void => {
  selectedVariantForAcmg.value = item
  nextTick(() => {
    acmgEvidenceDialogRef.value?.open()
  })
}

const handleAcmgEvidenceChange = async (payload: {
  classification: AcmgClassification | null
  evidenceJson: string
}): Promise<void> => {
  const v = selectedVariantForAcmg.value
  if (v === null) return
  await setGlobalAcmgClassificationWithEvidence(
    v.chr,
    v.pos,
    v.ref,
    v.alt,
    payload.classification,
    payload.evidenceJson
  )
}

const openCommentDialog = (item: CohortVariant) => {
  selectedVariantForComment.value = item
  commentDialogOpen.value = true
}

const handleCommentSave = async (data: {
  globalComment: string | null
  perCaseComment: string | null
  globalChanged: boolean
  perCaseChanged: boolean
}) => {
  if (!selectedVariantForComment.value) return
  const item = selectedVariantForComment.value

  // In cohort mode, only save global comments
  if (data.globalChanged) {
    await upsertGlobalComment(item.chr, item.pos, item.ref, item.alt, data.globalComment)
  }

  commentDialogOpen.value = false
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

// Export to Excel
const exportToExcel = async () => {
  // Guard for browser dev mode (no preload)
  if (!api) {
    // eslint-disable-next-line no-undef
    console.warn('API not available - running outside Electron')
    return
  }

  exporting.value = true
  try {
    // Build export params without pagination
    const exportParams = {
      search_term: searchTerm.value || undefined,
      gene_symbol: filters.value.geneSymbol || undefined,
      consequences:
        selectedImpactPresets.value.length > 0 ? selectedImpactPresets.value : undefined,
      funcs: filters.value.funcs.length > 0 ? filters.value.funcs : undefined,
      clinvars: filters.value.clinvars.length > 0 ? filters.value.clinvars : undefined,
      gnomad_af_max: filters.value.maxGnomadAf ?? undefined,
      cadd_min: filters.value.minCadd ?? undefined,
      cohort_frequency_min: filters.value.minCohortFrequency ?? undefined
    }

    // Deep clone to strip Vue proxies
    const plainParams = globalThis.structuredClone(exportParams)
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

// Watch variants and load annotations
watch(variants, async (newVariants) => {
  if (newVariants.length > 0) {
    await loadGlobalAnnotationsBatch(
      newVariants.map((v) => ({ chr: v.chr, pos: v.pos, ref: v.ref, alt: v.alt }))
    )
  }
})

// Lifecycle
onMounted(async () => {
  void fetchSummary()
  await fetchVariants(buildQueryParams())
})

// Expose refresh method
const refresh = async () => {
  void fetchSummary()
  await fetchVariants(buildQueryParams())
}
defineExpose({ refresh })
</script>

<style scoped>
/* CohortTable fills remaining height in flex parent */
.cohort-table-container {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>
