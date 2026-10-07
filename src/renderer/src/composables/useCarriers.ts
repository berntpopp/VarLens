/**
 * SINGLETON composable for lazy carrier loading with internal cache
 *
 * Extracts carrier loading logic from CohortTable.vue (lines 703-706, 1286-1320)
 * into a reusable composable with explicit return types.
 *
 * IMPORTANT: This is a SINGLETON - state is shared across all components.
 * This is intentional to allow CohortTable (parent) and CohortDataTable (child)
 * to share the same carrier cache. Parent loads carriers, child displays them.
 *
 * Provides:
 * - Expanded rows state for table expansion
 * - Carrier cache (Map) to prevent duplicate fetches
 * - Lazy loading - carriers fetched on demand
 * - Cache inspection methods (hasCarriers, getCarriers, hasCarrierError)
 * - reloadExpanded to refetch after the case set changed (import, delete)
 * - clearCache and reset methods for database context changes
 *
 * SOL-05: Centralized carrier management for CohortTable.vue.
 */

import { ref } from 'vue'
import type { Ref } from 'vue'
import type { CohortVariant, CohortCarrier } from '../../../shared/types/cohort'
import { isIpcError, unwrapIpcResult } from '../../../shared/types/errors'
import { useApiService } from './useApiService'
import { logService } from '../services/LogService'

// ============================================================================
// SINGLETON STATE - Module-scoped refs shared across all components
// ============================================================================

/** Expanded rows state (variant keys) - SINGLETON */
const expandedRows = ref<string[]>([])

/** Carrier cache - Map for O(1) lookup - SINGLETON */
const carrierMap = ref<Map<string, CohortCarrier[]>>(new Map())

/** Variant keys whose last load failed - SINGLETON */
const carrierErrors = ref<Set<string>>(new Set())

/** Loads under way, so concurrent requests for one variant share a call */
const inflight = new Map<string, Promise<void>>()

/** Bumped whenever the cache is cleared; a load started before must not write after */
let cacheEpoch = 0

function clearCarrierState(): void {
  cacheEpoch++
  carrierMap.value.clear()
  carrierErrors.value.clear()
  inflight.clear()
}

/**
 * Return type for useCarriers composable
 *
 * @property expandedRows - Array of expanded variant keys
 * @property carrierMap - Map of variant_key -> carriers (cache)
 * @property loadCarriers - Method to load carriers for a variant (if not cached)
 * @property reloadExpanded - Method to drop the cache and refetch the expanded rows
 * @property hasCarriers - Method to check if carriers are cached for a variant
 * @property hasCarrierError - Method to check if the last load for a variant failed
 * @property getCarriers - Method to get cached carriers for a variant
 * @property clearCache - Method to clear carrier cache (for database switch)
 * @property reset - Method to reset all state
 */
export interface UseCarriersReturn {
  /** Array of expanded variant keys */
  expandedRows: Ref<string[]>
  /** Map of variant_key -> carriers (cache) */
  carrierMap: Ref<Map<string, CohortCarrier[]>>
  /** Load carriers for a variant (if not cached) */
  loadCarriers: (variant: CohortVariant) => Promise<void>
  /** Drop cached carriers and refetch those of the expanded rows among `variants` */
  reloadExpanded: (variants: readonly CohortVariant[]) => Promise<void>
  /** Check if carriers are cached for a variant */
  hasCarriers: (variantKey: string) => boolean
  /** Check if the last carrier load for a variant failed */
  hasCarrierError: (variantKey: string) => boolean
  /** Get cached carriers for a variant */
  getCarriers: (variantKey: string) => CohortCarrier[] | undefined
  /** Clear carrier cache (for database switch, keeps expandedRows) */
  clearCache: () => void
  /** Reset all state (expandedRows and cache) */
  reset: () => void
}

/**
 * Composable for lazy carrier loading with internal cache
 *
 * @returns Object with carrier state refs and loading methods
 *
 * @example
 * ```typescript
 * const { expandedRows, carrierMap, loadCarriers, hasCarriers, getCarriers, reset } = useCarriers()
 *
 * // Bind expandedRows to v-data-table
 * <v-data-table v-model:expanded="expandedRows" />
 *
 * // Load carriers when row is expanded
 * watch(expandedRows, async (keys) => {
 *   for (const key of keys) {
 *     if (!hasCarriers(key)) {
 *       const variant = variants.find(v => v.variant_key === key)
 *       if (variant) await loadCarriers(variant)
 *     }
 *   }
 * })
 *
 * // Get cached carriers for display
 * const carriers = getCarriers(variant.variant_key)
 *
 * // Reset on database switch
 * reset()
 * ```
 */
export function useCarriers(): UseCarriersReturn {
  // Uses module-scoped singleton refs (defined above)
  // This ensures CohortTable and CohortDataTable share the same state
  const { api } = useApiService()

  /**
   * Load carriers for a specific variant
   *
   * Uses internal cache to prevent duplicate fetches. A failed load is not
   * cached: an empty list would read as "no carriers". The key is flagged in
   * `carrierErrors` instead and the next call retries.
   *
   * @param variant - The cohort variant to load carriers for
   */
  const loadCarriers = (variant: CohortVariant): Promise<void> => {
    // Guard for browser dev mode (no preload)
    if (!api) {
      return Promise.resolve()
    }

    const key = variant.variant_key

    // Skip if already cached
    if (carrierMap.value.has(key)) {
      return Promise.resolve()
    }

    const pending = inflight.get(key)
    if (pending !== undefined) return pending

    const epoch = cacheEpoch
    carrierErrors.value.delete(key)
    const load: Promise<void> = (async (): Promise<void> => {
      try {
        const carriers = unwrapIpcResult(
          await api.cohort.getCarriers(variant.chr, variant.pos, variant.ref, variant.alt)
        )
        if (epoch === cacheEpoch) carrierMap.value.set(key, carriers)
      } catch (error) {
        logService.error(
          'Failed to load carriers: ' +
            (error instanceof Error
              ? error.message
              : isIpcError(error)
                ? (error.userMessage ?? error.message)
                : String(error)),
          'carriers'
        )
        if (epoch === cacheEpoch) carrierErrors.value.add(key)
      }
    })().finally(() => {
      if (inflight.get(key) === load) inflight.delete(key)
    })
    inflight.set(key, load)
    return load
  }

  /**
   * Drop every cached carrier list and refetch for the rows that are expanded.
   *
   * Call after the set of cases changed (import, case delete): the cached
   * lists may name deleted cases or miss new ones.
   *
   * @param variants - The rows currently in the table
   */
  const reloadExpanded = async (variants: readonly CohortVariant[]): Promise<void> => {
    clearCarrierState()
    const expanded = new Set(expandedRows.value)
    await Promise.all(variants.filter((v) => expanded.has(v.variant_key)).map(loadCarriers))
  }

  /**
   * Check if carriers are cached for a variant
   *
   * @param variantKey - The variant key to check
   * @returns true if carriers are cached (even if empty array)
   */
  const hasCarriers = (variantKey: string): boolean => {
    return carrierMap.value.has(variantKey)
  }

  /**
   * Get cached carriers for a variant
   *
   * @param variantKey - The variant key to get carriers for
   * @returns The cached carriers array, or undefined if not cached
   */
  const getCarriers = (variantKey: string): CohortCarrier[] | undefined => {
    return carrierMap.value.get(variantKey)
  }

  /**
   * Check if the last carrier load for a variant failed
   *
   * @param variantKey - The variant key to check
   * @returns true until a later load for the variant starts
   */
  const hasCarrierError = (variantKey: string): boolean => {
    return carrierErrors.value.has(variantKey)
  }

  /**
   * Clear carrier cache (keeps expandedRows)
   *
   * Use for database switches where cached carriers are stale
   * but UI state (expanded rows) should be preserved.
   */
  const clearCache = (): void => {
    clearCarrierState()
  }

  /**
   * Reset all state (both expandedRows and carrier cache)
   *
   * Use for complete reset on database context changes.
   */
  const reset = (): void => {
    expandedRows.value = []
    clearCarrierState()
  }

  return {
    expandedRows,
    carrierMap,
    loadCarriers,
    reloadExpanded,
    hasCarriers,
    hasCarrierError,
    getCarriers,
    clearCache,
    reset
  }
}

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Reset singleton state for testing
 *
 * Call this in beforeEach() to ensure test isolation.
 * Only exported for testing - not part of the public API.
 */
export function _resetCarriersForTesting(): void {
  expandedRows.value = []
  clearCarrierState()
}
