/**
 * Composable for VEP enrichment data management
 *
 * Provides reactive VEP data state per variant with IPC-backed API calls.
 * Used by VariantDetailsPanel to fetch and display VEP enrichment data.
 */

import { ref, computed } from 'vue'
import type { VepFetchResult } from '../../../shared/types/api-enrichment'
import type {
  VepTranscriptConsequence,
  VepColocatedVariant
} from '../../../main/services/api/schemas/vep-response'

export function useVepEnrichment() {
  const vepData = ref<VepFetchResult | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // Computed properties from vepData
  const isOffline = computed(() => {
    if (vepData.value === null || vepData.value.success) return false
    return vepData.value.offline
  })

  const isCached = computed(() => {
    if (vepData.value === null || !vepData.value.success) return false
    return vepData.value.cacheInfo.cached
  })

  const cachedAt = computed<Date | null>(() => {
    if (vepData.value === null || !vepData.value.success) return null
    if (vepData.value.cacheInfo.cachedAt === null) return null
    return new Date(vepData.value.cacheInfo.cachedAt * 1000) // Unix timestamp to Date
  })

  // Get preferred transcript with scores
  const preferredTranscript = computed<VepTranscriptConsequence | null>(() => {
    if (vepData.value === null || !vepData.value.success) return null
    return vepData.value.preferredTranscript
  })

  // Get colocated variants (for rsID)
  const colocatedVariants = computed<VepColocatedVariant[]>(() => {
    if (vepData.value === null || !vepData.value.success) return []
    if (vepData.value.data.length === 0) return []
    return vepData.value.data[0].colocated_variants ?? []
  })

  // Get most severe consequence
  const mostSevereConsequence = computed<string | null>(() => {
    if (vepData.value === null || !vepData.value.success) return null
    if (vepData.value.data.length === 0) return null
    return vepData.value.data[0].most_severe_consequence ?? null
  })

  /**
   * Fetch VEP data for a variant
   */
  async function fetchVep(chr: string, pos: number, ref: string, alt: string): Promise<void> {
    isLoading.value = true
    error.value = null
    vepData.value = null

    try {
      const result = await window.api.vep.fetch(chr, pos, ref, alt)
      vepData.value = result

      if (!result.success) {
        error.value = result.error
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Unknown error'
      vepData.value = null
    } finally {
      isLoading.value = false
    }
  }

  return {
    vepData,
    isLoading,
    error,
    isOffline,
    isCached,
    cachedAt,
    preferredTranscript,
    colocatedVariants,
    mostSevereConsequence,
    fetchVep
  }
}
