/**
 * Shared filter core composable
 *
 * Thin shared layer for filter state and logic that is common to both the case
 * view (useFilterState) and the cohort view (createFilters/useFilters).
 *
 * Scope (ONLY these concerns):
 * - Generic state reset
 * - Active-filter derivation (count and list)
 * - Common numeric filter state (gnomAD AF, CADD, internal AF thresholds)
 * - Consequence, func, clinvar array state
 * - ACMG classification array state
 *
 * NOT in scope (stays in the adapters):
 * - Tags, gene autocomplete, export, annotation scope
 * - searchQuery / searchTerm semantics
 * - View-specific filter shapes and IPC serialization
 */

import { ref, computed } from 'vue'

/**
 * Active filter chip data produced by the core
 */
export interface CoreActiveFilter {
  id: string
  label: string
  value: string
}

/**
 * Create shared filter core state and helpers.
 *
 * Both useFilterState (case view) and createFilters (cohort view) call this
 * and delegate their shared refs to the returned values.
 */
export function useFilterCore() {
  // -------------------------------------------------------------------------
  // Shared reactive state
  // -------------------------------------------------------------------------

  /** Impact/consequence category filters (HIGH, MODERATE, etc.) */
  const consequences = ref<string[]>([])

  /** SO consequence term filters (missense_variant, etc.) */
  const funcs = ref<string[]>([])

  /** ClinVar classification filters */
  const clinvars = ref<string[]>([])

  /** Maximum gnomAD allele frequency (decimal 0-1), null = no filter */
  const gnomadAfMax = ref<number | null>(null)

  /** Minimum CADD phred score, null = no filter */
  const caddMin = ref<number | null>(null)

  /** Maximum internal allele frequency (decimal 0-1), null = no filter */
  const maxInternalAf = ref<number | null>(null)

  /** ACMG classification filters */
  const acmgClassifications = ref<string[]>([])

  // -------------------------------------------------------------------------
  // Computed: active filter count (shared fields only)
  // -------------------------------------------------------------------------

  const activeFilterCount = computed<number>(() => {
    let count = 0
    if (consequences.value.length > 0) count++
    if (funcs.value.length > 0) count++
    if (clinvars.value.length > 0) count++
    if (gnomadAfMax.value !== null && !Number.isNaN(gnomadAfMax.value) && gnomadAfMax.value > 0)
      count++
    if (caddMin.value !== null && !Number.isNaN(caddMin.value) && caddMin.value >= 0) count++
    if (
      maxInternalAf.value !== null &&
      !Number.isNaN(maxInternalAf.value) &&
      maxInternalAf.value > 0
    )
      count++
    if (acmgClassifications.value.length > 0) count++
    return count
  })

  // -------------------------------------------------------------------------
  // Computed: active filters list (shared fields only)
  // -------------------------------------------------------------------------

  const activeFiltersList = computed<CoreActiveFilter[]>(() => {
    const list: CoreActiveFilter[] = []

    if (consequences.value.length > 0) {
      list.push({
        id: 'consequences',
        label: 'Impact',
        value: `${consequences.value.length} selected`
      })
    }
    if (funcs.value.length > 0) {
      list.push({ id: 'funcs', label: 'Function', value: `${funcs.value.length} selected` })
    }
    if (clinvars.value.length > 0) {
      list.push({ id: 'clinvars', label: 'ClinVar', value: `${clinvars.value.length} selected` })
    }
    if (gnomadAfMax.value !== null && !Number.isNaN(gnomadAfMax.value) && gnomadAfMax.value > 0) {
      const pct = (gnomadAfMax.value * 100).toFixed(2)
      list.push({ id: 'gnomad_af', label: 'gnomAD AF', value: `\u2264 ${pct}%` })
    }
    if (caddMin.value !== null && !Number.isNaN(caddMin.value) && caddMin.value >= 0) {
      list.push({ id: 'cadd', label: 'CADD', value: `\u2265 ${caddMin.value}` })
    }
    if (
      maxInternalAf.value !== null &&
      !Number.isNaN(maxInternalAf.value) &&
      maxInternalAf.value > 0
    ) {
      const pct = (maxInternalAf.value * 100).toFixed(2)
      list.push({ id: 'internal_af', label: 'Internal AF', value: `\u2264 ${pct}%` })
    }
    if (acmgClassifications.value.length > 0) {
      list.push({
        id: 'acmg',
        label: 'ACMG',
        value: acmgClassifications.value.join(', ')
      })
    }

    return list
  })

  // -------------------------------------------------------------------------
  // Reset all shared fields
  // -------------------------------------------------------------------------

  function reset(): void {
    consequences.value = []
    funcs.value = []
    clinvars.value = []
    gnomadAfMax.value = null
    caddMin.value = null
    maxInternalAf.value = null
    acmgClassifications.value = []
  }

  // -------------------------------------------------------------------------
  // Clear a single shared filter by ID
  // -------------------------------------------------------------------------

  function clearFilter(id: string): void {
    switch (id) {
      case 'consequences':
        consequences.value = []
        break
      case 'funcs':
        funcs.value = []
        break
      case 'clinvars':
        clinvars.value = []
        break
      case 'gnomad_af':
        gnomadAfMax.value = null
        break
      case 'cadd':
        caddMin.value = null
        break
      case 'internal_af':
        maxInternalAf.value = null
        break
      case 'acmg':
        acmgClassifications.value = []
        break
      // Unknown IDs are silently ignored (no-op)
    }
  }

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------

  return {
    // Shared state refs
    consequences,
    funcs,
    clinvars,
    gnomadAfMax,
    caddMin,
    maxInternalAf,
    acmgClassifications,

    // Computed
    activeFilterCount,
    activeFiltersList,

    // Methods
    reset,
    clearFilter
  }
}
