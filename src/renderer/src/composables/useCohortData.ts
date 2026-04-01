/**
 * Composable for cohort variant data loading with pagination
 *
 * Extracts data loading logic from CohortTable.vue (lines 982-1048, 964-980)
 * into a reusable composable with explicit return types.
 *
 * Provides:
 * - Variant fetching with pagination and filtering
 * - Loading state management
 * - Error handling via ref (consumer decides how to display)
 * - Cohort summary fetching
 * - Summary staleness tracking via IPC listener
 * - Reset method for database context changes
 *
 * SOL-02: Centralized cohort data management for CohortTable.vue.
 */

import { ref, shallowRef, markRaw } from 'vue'
import type { Ref, ShallowRef } from 'vue'
import type { CohortVariant, CohortSummary } from '../../../shared/types/cohort'
import type { ColumnFilterMeta } from '../../../shared/types/column-filters'
import type { ColumnFiltersParam } from '../../../shared/types/column-filters'
import { useApiService } from './useApiService'
import { cloneForIpc } from '../utils/cloneForIpc'
import { logService } from '../services/LogService'

/**
 * Query parameters for cohort variant fetching
 */
export interface CohortQueryParams {
  /** Number of items per page */
  limit: number
  /** Offset for pagination: (page - 1) * limit */
  offset?: number
  /** Column to sort by */
  sort_by?: string
  /** Sort direction */
  sort_order: 'asc' | 'desc'
  /** Search term (gene symbol, chr:pos) */
  search_term?: string
  /** Gene symbol exact match */
  gene_symbol?: string
  /** Impact levels to include (HIGH, MODERATE, LOW) */
  consequences?: string[]
  /** Functional consequence types to include */
  funcs?: string[]
  /** ClinVar classifications to include */
  clinvars?: string[]
  /** Maximum gnomAD allele frequency */
  gnomad_af_max?: number
  /** Minimum CADD phred score */
  cadd_min?: number
  /** Maximum internal allele frequency (cohort_frequency) */
  max_internal_af?: number
  /** Minimum carrier count */
  carrier_count_min?: number
  /** Show only starred variants (global annotations) */
  starred_only?: boolean
  /** Show only variants with comments (global annotations) */
  has_comment?: boolean
  /** Filter by ACMG classifications (global annotations) */
  acmg_classifications?: string[]
  /** Per-column typed filters from table header inputs */
  column_filters?: ColumnFiltersParam
  /** Active panel IDs for region-based filtering */
  active_panel_ids?: number[]
  /** Padding in base pairs for panel interval computation */
  panel_padding_bp?: number
  /** Whether the COUNT(*) query is needed; set to false to skip (used by pagination count cache) */
  _count_needed?: boolean
}

/** Raw result from cohort variant query (before state update) */
export interface CohortQueryResult {
  data: CohortVariant[]
  total_count: number
}

export interface UseCohortDataReturn {
  /** Array of cohort variants */
  variants: ShallowRef<CohortVariant[]>
  /** Total count for pagination */
  totalCount: Ref<number>
  /** Loading state */
  isLoading: Ref<boolean>
  /** Error state - consumer decides how to display */
  error: Ref<Error | null>
  /** Cohort summary statistics */
  summary: Ref<CohortSummary | null>
  /** Whether the cohort summary is stale (being rebuilt) */
  summaryStale: Ref<boolean>
  /** Per-column metadata for filter UI auto-detection */
  columnMeta: Ref<ColumnFilterMeta[]>
  /** Build IPC-safe params from query parameters */
  buildIpcParams: (params: CohortQueryParams) => Record<string, unknown>
  /** Fetch variants and update reactive state */
  fetchVariants: (params: CohortQueryParams) => Promise<void>
  /** Fetch cohort summary */
  fetchSummary: () => Promise<void>
  /** Fetch column metadata for filter auto-detection */
  fetchColumnMeta: () => Promise<void>
  /** Reset all state (for database context changes) */
  reset: () => void
  /** Clean up IPC listeners (call on component unmount) */
  cleanupListeners: () => void
  /** Whether the composable is active (inside <keep-alive>) */
  isActive: Ref<boolean>
  /** Activate: re-register listeners (call from onActivated) */
  activate: () => void
  /** Deactivate: unregister listeners (call from onDeactivated) */
  deactivate: () => void
}

export function useCohortData(): UseCohortDataReturn {
  const { api } = useApiService()

  // State refs
  const variants = shallowRef<CohortVariant[]>([])
  const totalCount = ref(0)
  const isLoading = ref(false)
  const error = ref<Error | null>(null)
  const summary = ref<CohortSummary | null>(null)
  const summaryStale = ref(false)
  const columnMeta = ref<ColumnFilterMeta[]>([])

  // Generation counter and filter cache for count optimization
  let requestGeneration = 0
  let cachedFilterHash = ''

  // Activation state for <keep-alive> gating
  const isActive = ref(true)

  // Listen for summary rebuild events and initialize staleness state
  let cleanupSummaryListener: (() => void) | null = null

  function registerSummaryListener(): void {
    if (!api || cleanupSummaryListener) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cohortApi = (api as any).cohort
    if (typeof cohortApi.onSummaryRebuilt === 'function') {
      cleanupSummaryListener = cohortApi.onSummaryRebuilt((status: { is_stale: boolean }) => {
        summaryStale.value = status.is_stale
      })
    }
  }

  function unregisterSummaryListener(): void {
    if (cleanupSummaryListener) {
      cleanupSummaryListener()
      cleanupSummaryListener = null
    }
  }

  // Register on init
  registerSummaryListener()

  // Initialize staleness from current status (catches in-progress rebuilds)
  if (api) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cohortApi = (api as any).cohort
    if (typeof cohortApi.getSummaryStatus === 'function') {
      cohortApi
        .getSummaryStatus()
        .then((status: { is_stale: boolean }) => {
          summaryStale.value = status.is_stale
        })
        .catch((e: unknown) => {
          logService.warn(
            'Failed to get cohort summary status: ' + (e instanceof Error ? e.message : String(e)),
            'cohort'
          )
        })
    }
  }

  function activate(): void {
    isActive.value = true
    registerSummaryListener()
  }

  function deactivate(): void {
    isActive.value = false
    unregisterSummaryListener()
  }

  const cleanupListeners = (): void => {
    unregisterSummaryListener()
  }

  /**
   * Build IPC-safe params from query parameters.
   * Filters out undefined values and strips Vue reactive proxies.
   */
  const buildIpcParams = (params: CohortQueryParams): Record<string, unknown> => {
    const ipcParams: Record<string, unknown> = {
      limit: params.limit,
      sort_order: params.sort_order
    }

    if (params.offset !== undefined && params.offset > 0) {
      ipcParams.offset = params.offset
    }
    if (params.sort_by !== undefined && params.sort_by !== '') {
      ipcParams.sort_by = params.sort_by
    }
    if (params.search_term !== undefined && params.search_term !== '') {
      ipcParams.search_term = params.search_term
    }
    if (params.gene_symbol !== undefined && params.gene_symbol !== '') {
      ipcParams.gene_symbol = params.gene_symbol
    }
    if (params.consequences !== undefined && params.consequences.length > 0) {
      ipcParams.consequences = [...params.consequences]
    }
    if (params.funcs !== undefined && params.funcs.length > 0) {
      ipcParams.funcs = [...params.funcs]
    }
    if (params.clinvars !== undefined && params.clinvars.length > 0) {
      ipcParams.clinvars = [...params.clinvars]
    }
    if (params.gnomad_af_max !== undefined) {
      ipcParams.gnomad_af_max = params.gnomad_af_max
    }
    if (params.cadd_min !== undefined) {
      ipcParams.cadd_min = params.cadd_min
    }
    if (params.max_internal_af !== undefined) {
      ipcParams.max_internal_af = params.max_internal_af
    }
    if (params.carrier_count_min !== undefined) {
      ipcParams.carrier_count_min = params.carrier_count_min
    }
    if (params.starred_only === true) {
      ipcParams.starred_only = true
    }
    if (params.has_comment === true) {
      ipcParams.has_comment = true
    }
    if (params.acmg_classifications !== undefined && params.acmg_classifications.length > 0) {
      ipcParams.acmg_classifications = [...params.acmg_classifications]
    }
    if (params.column_filters !== undefined) {
      // Deep-clone to strip Vue reactive proxies for IPC serialization
      ipcParams.column_filters = cloneForIpc(params.column_filters)
    }
    if (params.active_panel_ids !== undefined && params.active_panel_ids.length > 0) {
      ipcParams.active_panel_ids = [...params.active_panel_ids]
      if (params.panel_padding_bp !== undefined) {
        ipcParams.panel_padding_bp = params.panel_padding_bp
      }
    }

    return ipcParams
  }

  /**
   * Fetch variants and update reactive state.
   * Uses generation counter to discard stale responses and count caching
   * to skip COUNT queries on pagination/sort changes.
   */
  const fetchVariants = async (params: CohortQueryParams): Promise<void> => {
    if (!api) {
      logService.warn('API not available - running outside Electron', 'cohort')
      return
    }

    const thisGeneration = ++requestGeneration
    isLoading.value = true
    error.value = null

    try {
      // Determine if filters changed (exclude pagination/sort params)
      const filterHash = JSON.stringify({
        search_term: params.search_term,
        gene_symbol: params.gene_symbol,
        consequences: params.consequences,
        funcs: params.funcs,
        clinvars: params.clinvars,
        gnomad_af_max: params.gnomad_af_max,
        cadd_min: params.cadd_min,
        max_internal_af: params.max_internal_af,
        carrier_count_min: params.carrier_count_min,
        starred_only: params.starred_only,
        has_comment: params.has_comment,
        acmg_classifications: params.acmg_classifications,
        column_filters: params.column_filters,
        active_panel_ids: params.active_panel_ids,
        panel_padding_bp: params.panel_padding_bp
      })
      const filtersChanged = filterHash !== cachedFilterHash

      const ipcParams = buildIpcParams(params)
      if (!filtersChanged) {
        ipcParams._count_needed = false
      }

      // No structuredClone — buildIpcParams already strips Vue Proxies via spread
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (api as any).cohort.getVariants(ipcParams)

      // Discard stale responses from superseded requests
      if (thisGeneration !== requestGeneration) return

      variants.value = markRaw(result.data ?? [])
      if (filtersChanged) {
        totalCount.value = result.total_count ?? 0
        cachedFilterHash = filterHash
      }
    } catch (err) {
      if (thisGeneration !== requestGeneration) return
      error.value = err instanceof Error ? err : new Error(String(err))
      variants.value = []
      totalCount.value = 0
    } finally {
      if (thisGeneration === requestGeneration) {
        isLoading.value = false
      }
    }
  }

  /**
   * Fetch cohort summary statistics
   */
  const fetchSummary = async (): Promise<void> => {
    // Guard for browser dev mode
    if (!api) {
      return
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (api as any).cohort.getSummary()
      summary.value = result
    } catch (err) {
      logService.error(
        'Failed to load cohort summary: ' + (err instanceof Error ? err.message : String(err)),
        'cohort'
      )
    }
  }

  /**
   * Fetch per-column metadata for filter UI auto-detection
   */
  const fetchColumnMeta = async (): Promise<void> => {
    if (!api) return

    try {
      const result = await api.cohort.getColumnMeta()
      columnMeta.value = result ?? []
    } catch (e) {
      logService.warn(
        'Failed to load column metadata: ' + (e instanceof Error ? e.message : String(e)),
        'cohort'
      )
      columnMeta.value = []
    }
  }

  /**
   * Reset all state (for database context changes)
   */
  const reset = (): void => {
    variants.value = []
    totalCount.value = 0
    error.value = null
    summary.value = null
    summaryStale.value = false
    columnMeta.value = []
    cachedFilterHash = ''
    requestGeneration = 0
  }

  return {
    variants,
    totalCount,
    isLoading,
    error,
    summary,
    summaryStale,
    columnMeta,
    buildIpcParams,
    fetchVariants,
    fetchSummary,
    fetchColumnMeta,
    reset,
    cleanupListeners,
    isActive,
    activate,
    deactivate
  }
}
