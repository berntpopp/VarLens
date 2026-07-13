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

    <!-- Rebuild indicator — the cohort summary table is rebuilt in a worker
         whenever cases are imported/deleted, and the cohort view can't show
         meaningful data until it finishes.
         -
         Design notes (see research in git history):
         - A plain styled div (not v-alert/v-banner) avoids Vuetify theme
           min-heights that fight scoped :deep overrides.
         - The whole notice has a shimmer gradient sweeping left-to-right
           so the motion is where the user is looking, not tucked into a
           corner spinner (NN/g + Material M3 skeleton pattern).
         - Elapsed seconds tick live from `rebuildElapsedSec`.
         - If a previous rebuild's duration is cached in localStorage we
           show it as a soft ETA ("~Ns last time"). Even an inaccurate
           estimate is better than none (Apple HIG).
         - No backend changes: rebuild-summary-worker is opaque
           (one 'complete' event, no phase reporting), so all progress
           signals are derived on the renderer side. -->
    <div v-if="summaryStale" class="cohort-rebuild-notice" role="status" aria-live="polite">
      <v-icon :icon="mdiDatabaseSync" size="14" class="cohort-rebuild-notice__icon" />
      <span class="cohort-rebuild-notice__text">
        <template v-if="rebuildPhaseLabel !== null">
          {{ rebuildPhaseLabel }} ({{ rebuildPhaseIndex }}/{{ rebuildPhaseTotal }}) —
          {{ rebuildElapsedSec }}s elapsed<span v-if="rebuildEtaLabel !== null">
            ({{ rebuildEtaLabel }})</span
          >
        </template>
        <template v-else>
          Rebuilding cohort index — {{ rebuildElapsedSec }}s elapsed<span
            v-if="rebuildEtaLabel !== null"
          >
            ({{ rebuildEtaLabel }})</span
          >
        </template>
      </span>
    </div>

    <!-- Filter Bar -->
    <!--
      A3 cohort parity (Pass-9 #3): deferred mount. CohortFilterBar is gated
      on `firstActivated` so it does not render until cohort column metadata
      has arrived. The CohortDataTable below is unguarded so its own
      `update:options` immediate fetch still drives the first page load.
      `firstActivated` flips true once metadata loads and never resets.
    -->
    <CohortFilterBar
      v-if="firstActivated"
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
      @changed="handleAnnotationChanged"
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
import { ref, computed, watch, onMounted, onUnmounted, onActivated, onDeactivated } from 'vue'
// Composables
import { useOffsetPagination } from '../composables/useOffsetPagination'
import { useCohortData } from '../composables/useCohortData'
import { useFilters } from '../composables/useFilters'
import { useCarriers } from '../composables/useCarriers'
import { useAnnotations } from '../composables/useAnnotations'
import { useColumnPreferences } from '../composables/useColumnPreferences'
import { useApiService } from '../composables/useApiService'
import { logService } from '../services/LogService'
import { traceStart, traceEnd } from '../services/PerfTrace'
import type { PerfBudgetKey } from '../../../shared/config/perf-budgets'
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
import { isIpcError, unwrapIpcResult } from '../../../shared/types/errors'
import type { AcmgClassification } from '../../../shared/config/domain.config'
import { getCurrentUnsupportedReason } from '../utils/backend-capabilities'
import { isWebRuntime } from '../utils/runtime-mode'

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
  rebuildPhaseIndex,
  rebuildPhaseTotal,
  rebuildPhaseLabel,
  columnMeta,
  genomeBuild,
  selectedVariantType,
  fetchSummary,
  fetchColumnMeta,
  buildIpcParams,
  cleanupListeners,
  isActive,
  activate,
  deactivate
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

async function getCohortQueryBlockReason(): Promise<string | null> {
  return getCurrentUnsupportedReason('cohort.query')
}

async function getCohortExportBlockReason(): Promise<string | null> {
  return getCurrentUnsupportedReason('export.cohort')
}

async function fetchSupportedCohortSummary(): Promise<void> {
  const reason = await getCurrentUnsupportedReason('cohort.summary')
  if (reason !== null) {
    logService.warn(reason, 'backend-capabilities')
    return
  }

  await fetchSummary()
}

async function fetchSupportedCohortColumnMeta(): Promise<void> {
  const reason = await getCurrentUnsupportedReason('cohort.columnMeta')
  if (reason !== null) {
    logService.warn(reason, 'backend-capabilities')
    return
  }

  await fetchColumnMeta()
}

// Flow trace tracking
let activeFlowTraceId: string | null = null
let activeFlowBudget: PerfBudgetKey | undefined = undefined

// Ref to CohortFilterBar for accessing DSL column filters
const cohortFilterBarRef = ref<InstanceType<typeof CohortFilterBar> | null>(null)

/**
 * True once `fetchColumnMeta` has resolved with at least one column.
 * `[]` is the not-yet-loaded sentinel; any populated array means the
 * cohort-metadata IPC round-trip finished. This is the cohort equivalent
 * of CaseView's `typeCountsLoaded`.
 *
 * Trade-off (Pass-9 #4): this reuses the established CaseView
 * "populated-array = loaded" convention. If `fetchColumnMeta` fails or the
 * backend is capability-blocked, `columnMeta` stays `[]` and the filter bar
 * never mounts even though the unguarded CohortDataTable still loads. We
 * deliberately keep parity with CaseView rather than introduce a divergent
 * "fetch settled" sentinel here; tightening this is a cross-view change.
 */
const columnMetaLoaded = computed(() => columnMeta.value.length > 0)

/**
 * A3 cohort parity (Pass-9 #3): deferred CohortFilterBar mount. Flips true
 * the first time cohort column metadata has loaded. Once true it never
 * resets, mirroring the CaseView `firstActivated` pattern so the filter bar
 * does not remount (and re-run its option load) across genome-build /
 * variant-type changes. Required by feedback_cohort_parity.md.
 */
const firstActivated = ref(false)

watch(
  columnMetaLoaded,
  (loaded) => {
    if (loaded && !firstActivated.value) {
      firstActivated.value = true
    }
  },
  { immediate: true }
)

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
  max_internal_af: filters.value.maxInternalAf ?? undefined,
  starred_only: filters.value.starredOnly || undefined,
  has_comment: filters.value.hasCommentOnly || undefined,
  acmg_classifications:
    filters.value.acmgClassifications.length > 0
      ? [...filters.value.acmgClassifications]
      : undefined,
  column_filters:
    cohortColumnFilters.value != null ||
    Object.keys(cohortFilterBarRef.value?.dslColumnFilters ?? {}).length > 0 ||
    Object.keys(filters.value.columnFilters).length > 0
      ? {
          ...(cohortColumnFilters.value ?? {}),
          ...filters.value.columnFilters,
          ...(cohortFilterBarRef.value?.dslColumnFilters ?? {})
        }
      : undefined,
  active_panel_ids:
    filters.value.activePanelIds.length > 0 ? [...filters.value.activePanelIds] : undefined,
  panel_padding_bp:
    filters.value.activePanelIds.length > 0 ? filters.value.panelPaddingBp : undefined
})

const hasAnnotationBackedFilters = computed(
  () =>
    filters.value.starredOnly === true ||
    filters.value.hasCommentOnly === true ||
    filters.value.acmgClassifications.length > 0
)

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
  fetchPage: async ({ offset, limit, sortBy: sortItems, skipCount }) => {
    if (!api || !isActive.value) {
      return { data: [], total_count: 0 }
    }

    const reason = await getCohortQueryBlockReason()
    if (reason !== null) {
      logService.warn(reason, 'backend-capabilities')
      throw new Error(reason)
    }

    const sortKey = sortItems.length > 0 ? sortItems[0].key : undefined
    const sortOrder: 'asc' | 'desc' = sortItems.length > 0 ? sortItems[0].order : 'desc'

    const params: CohortQueryParams = {
      limit,
      offset,
      sort_by: sortKey,
      sort_order: sortOrder,
      ...buildCohortQueryParams(),
      _count_needed: skipCount !== true
    }

    const plainParams = buildIpcParams(params)
    const result = unwrapIpcResult(await api.cohort.getVariants(plainParams))

    return {
      data: result.data ?? [],
      total_count: result.total_count ?? 0
    }
  },
  onSortChange: (sorted) => {
    hasSort.value = sorted
  },
  prefetchEnabled: isActive
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

  const reason = await getCohortExportBlockReason()
  if (reason !== null) {
    logService.warn(reason, 'backend-capabilities')
    snackbar.value = {
      visible: true,
      message: reason,
      color: 'error',
      timeout: -1,
      actionText: null,
      actionCallback: null
    }
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
      max_internal_af: filters.value.maxInternalAf ?? undefined,
      genome_build: genomeBuild.value || undefined,
      variant_type: selectedVariantType.value || undefined
    }
    const result = unwrapIpcResult(await api.export.cohort(plainParams))

    if (result !== null && result !== undefined && result.success === true) {
      snackbar.value = {
        visible: true,
        message: `Exported to ${result.filePath}`,
        color: 'success',
        timeout: 3000,
        actionText: 'Open folder',
        actionCallback: () => {
          if (result.filePath != null && result.filePath !== '')
            void api.export.revealInFolder(result.filePath)
        }
      }
    } else if (result?.error != null && result.error !== '') {
      snackbar.value = {
        visible: true,
        message: `Export failed: ${result.error}`,
        color: 'error',
        timeout: -1,
        actionText: null,
        actionCallback: null
      }
    }
  } catch (error) {
    const message = isIpcError(error)
      ? (error.userMessage ?? error.message)
      : error instanceof Error
        ? error.message
        : String(error)
    snackbar.value = {
      visible: true,
      message: `Export failed: ${message}`,
      color: 'error',
      timeout: -1,
      actionText: null,
      actionCallback: null
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
const handleFilterChange = () => {
  if (import.meta.env.DEV) {
    if (activeFlowTraceId !== null) traceEnd(activeFlowTraceId, activeFlowBudget)
    activeFlowTraceId = traceStart('cohort-filter-apply')
    activeFlowBudget = 'FILTER_APPLY'
  }
  invalidateAndReload()
}

const handleClearAll = async () => {
  if (import.meta.env.DEV) {
    if (activeFlowTraceId !== null) traceEnd(activeFlowTraceId, activeFlowBudget)
    activeFlowTraceId = traceStart('cohort-filter-apply')
    activeFlowBudget = 'FILTER_APPLY'
  }
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

const handleAnnotationChanged = (): void => {
  if (!isWebRuntime() || !hasAnnotationBackedFilters.value) return
  void invalidateAndReload()
}

// Delegate annotation events to AnnotationDialogs
const handleStarToggle = (item: CohortVariant) => {
  annotationDialogsRef.value?.handleStarToggle(item)
}

const handleAcmgSelect = (payload: {
  item: CohortVariant
  classification: AcmgClassification | null
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
  if (!isActive.value) return
  debouncedLoadAnnotations(newVariants)
  // End flow trace when new data arrives (primary visual update)
  if (import.meta.env.DEV && activeFlowTraceId !== null) {
    traceEnd(activeFlowTraceId, activeFlowBudget)
    activeFlowTraceId = null
  }
})

// ── Rebuild progress tracking ───────────────────────────────────────
// Since the rebuild-summary-worker is opaque (sends exactly one 'complete'
// event with no phase/progress data — see src/main/workers/rebuild-summary-
// worker.ts), the renderer derives progress signals from a local timer plus
// a cached duration from the previous successful rebuild. Per Apple HIG:
// even an inaccurate estimate is better than no estimate. The elapsed count
// keeps the user informed that work is happening (NN/g 2-10s threshold).
const REBUILD_DURATION_STORAGE_KEY = 'varlens.cohort.lastRebuildDurationSec'
const rebuildElapsedSec = ref(0)
const rebuildEtaLabel = ref<string | null>(null)
let rebuildStartMs: number | null = null
let rebuildTimerId: ReturnType<typeof setInterval> | null = null

function readCachedEtaLabel(): string | null {
  try {
    const cached = localStorage.getItem(REBUILD_DURATION_STORAGE_KEY)
    if (cached === null) return null
    const sec = Number(cached)
    if (!Number.isFinite(sec) || sec <= 0) return null
    return `~${Math.round(sec)}s last time`
  } catch {
    // localStorage can throw in sandboxed contexts; silently skip the ETA.
    return null
  }
}

function startRebuildTimer(): void {
  rebuildStartMs = Date.now()
  rebuildElapsedSec.value = 0
  rebuildEtaLabel.value = readCachedEtaLabel()
  if (rebuildTimerId !== null) clearInterval(rebuildTimerId)
  rebuildTimerId = setInterval(() => {
    if (rebuildStartMs !== null) {
      rebuildElapsedSec.value = Math.floor((Date.now() - rebuildStartMs) / 1000)
    }
  }, 500)
}

function stopRebuildTimer(success: boolean): void {
  if (rebuildTimerId !== null) {
    clearInterval(rebuildTimerId)
    rebuildTimerId = null
  }
  // Persist the observed duration on successful rebuilds so the next
  // rebuild can show a better estimate. Skip on error/cancel.
  if (success && rebuildStartMs !== null) {
    const durationSec = Math.max(1, Math.round((Date.now() - rebuildStartMs) / 1000))
    try {
      localStorage.setItem(REBUILD_DURATION_STORAGE_KEY, String(durationSec))
    } catch {
      // Ignore localStorage failures — ETA is a nice-to-have, not required.
    }
  }
  rebuildStartMs = null
  rebuildElapsedSec.value = 0
  rebuildEtaLabel.value = null
}

// Auto-refresh when summary rebuild completes + drive the progress timer.
watch(
  summaryStale,
  (newVal, oldVal) => {
    if (oldVal !== true && newVal === true) {
      // Rebuild just started — kick off the elapsed-time counter.
      startRebuildTimer()
      return
    }
    if (oldVal === true && newVal === false) {
      // Summary rebuilt — stop timer, cache duration, refresh current page
      // and metadata.
      stopRebuildTimer(true)
      void invalidateAndReload()
      void fetchSupportedCohortSummary()
      void fetchSupportedCohortColumnMeta()
    }
  },
  { immediate: true }
)

// Fetch summary + column metadata on mount so the filter chip can show
// filtered/total from the start. Table data itself loads via v-data-table-server's
// immediate update:options event, so we only need summary + meta here.
onMounted(() => {
  void fetchSupportedCohortSummary()
  void fetchSupportedCohortColumnMeta()
})

onUnmounted(() => {
  cleanupListeners()
  // Clean up the rebuild progress timer if the view is torn down mid-rebuild.
  // stopRebuildTimer(false) skips persisting the duration since we don't know
  // if the rebuild actually completed.
  stopRebuildTimer(false)
})

onActivated(() => {
  activate()
})

onDeactivated(() => {
  deactivate()
})

// Expose refresh method — single entry point for all data loading
const refresh = async () => {
  await Promise.all([
    fetchSupportedCohortSummary(),
    fetchSupportedCohortColumnMeta(),
    invalidateAndReload()
  ])
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

/* Prevent alerts/indicators from growing — only the data table gets the
   remaining flex space. */
.cohort-table-container > .v-alert,
.cohort-table-container > .cohort-rebuild-notice {
  flex-shrink: 0;
}

/* Rebuild notice: plain styled div, total height ~26 px.
   -
   Motion: a linear-gradient shimmer sweeps left-to-right behind the text
   so the whole notice visibly pulses. Uses `background-size: 200% 100%`
   + animated `background-position` — the classic Material M3 skeleton
   pattern. We keep the underlying fill tinted with the info theme color
   so the tonal identity carries over from v-alert conventions. */
@keyframes cohort-rebuild-shimmer {
  from {
    background-position: 200% 0;
  }
  to {
    background-position: -200% 0;
  }
}

.cohort-rebuild-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  margin-bottom: 8px;
  color: rgb(var(--v-theme-info));
  border-left: 2px solid rgb(var(--v-theme-info));
  border-radius: 2px;
  font-size: 12px;
  line-height: 1.4;
  /* Base tint + shimmer highlight band. The middle stop at 0.18 alpha is
     brighter than the 0.06 edges so the user sees a sweeping highlight. */
  background-image: linear-gradient(
    90deg,
    rgba(var(--v-theme-info), 0.06) 0%,
    rgba(var(--v-theme-info), 0.18) 50%,
    rgba(var(--v-theme-info), 0.06) 100%
  );
  background-size: 200% 100%;
  background-repeat: no-repeat;
  animation: cohort-rebuild-shimmer 1.6s linear infinite;
}

/* Accessibility: honor prefers-reduced-motion by swapping the shimmer for
   a static tinted background. The elapsed-time counter still updates every
   500 ms so the user retains a sense of progress without motion. */
@media (prefers-reduced-motion: reduce) {
  .cohort-rebuild-notice {
    animation: none;
    background-image: none;
    background-color: rgba(var(--v-theme-info), 0.1);
  }
}

.cohort-rebuild-notice__text {
  flex: 1 1 auto;
}

.cohort-rebuild-notice__icon {
  flex-shrink: 0;
}
</style>
