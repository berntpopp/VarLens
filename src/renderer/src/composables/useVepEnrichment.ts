/**
 * Composable for variant enrichment data management
 *
 * Fetches data from multiple APIs in parallel:
 * - Ensembl VEP (SIFT, PolyPhen, CADD, consequences, rsID)
 * - myvariant.info (REVEL, AlphaMissense)
 * - SpliceAI Lookup (SpliceAI delta scores)
 *
 * Used by VariantDetailsPanel to fetch and display enrichment data.
 */

import { ref, computed } from 'vue'
import type {
  VepFetchResult,
  MyVariantFetchResult,
  SpliceAIFetchResult,
  MyVariantScores,
  SpliceAIScores
} from '../../../shared/types/api-enrichment'
import type {
  VepTranscriptConsequence,
  VepColocatedVariant
} from '../../../main/services/api/schemas/vep-response'
import { useApiService } from './useApiService'

export function useVepEnrichment() {
  const { api } = useApiService()

  // VEP data
  const vepData = ref<VepFetchResult | null>(null)
  const vepLoading = ref(false)
  const vepError = ref<string | null>(null)

  // MyVariant data (REVEL, AlphaMissense)
  const myvariantData = ref<MyVariantFetchResult | null>(null)
  const myvariantLoading = ref(false)

  // SpliceAI data
  const spliceaiData = ref<SpliceAIFetchResult | null>(null)
  const spliceaiLoading = ref(false)

  // Generation counter to guard against stale async results
  let fetchGeneration = 0

  // Combined loading state
  const isLoading = computed(
    () => vepLoading.value || myvariantLoading.value || spliceaiLoading.value
  )

  // Combined error
  const error = computed(() => vepError.value)

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
    return new Date(vepData.value.cacheInfo.cachedAt * 1000)
  })

  // Get preferred transcript with scores
  const preferredTranscript = computed<VepTranscriptConsequence | null>(() => {
    if (vepData.value === null || !vepData.value.success) return null
    return vepData.value.preferredTranscript
  })

  // Get all transcript consequences from VEP response
  const allTranscripts = computed<VepTranscriptConsequence[]>(() => {
    if (vepData.value === null || !vepData.value.success) return []
    return vepData.value.allTranscripts
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

  // MyVariant scores
  const myvariantScores = computed<MyVariantScores | null>(() => {
    if (myvariantData.value === null || !myvariantData.value.success) return null
    return myvariantData.value.scores
  })

  // SpliceAI scores
  const spliceaiScores = computed<SpliceAIScores | null>(() => {
    if (spliceaiData.value === null || !spliceaiData.value.success) return null
    return spliceaiData.value.scores
  })

  // Convenience getters for specific scores
  const revelScore = computed<number | null>(() => myvariantScores.value?.revel_score ?? null)
  const alphamissenseScore = computed<number | null>(
    () => myvariantScores.value?.alphamissense_score ?? null
  )
  const spliceaiMaxDelta = computed<number | null>(() => spliceaiScores.value?.max_delta ?? null)

  /**
   * Clear all enrichment data (call on variant change).
   * Increments the generation counter so any in-flight fetchVep()
   * from a previous variant will discard its results.
   */
  function clearData(): void {
    fetchGeneration++
    vepData.value = null
    vepLoading.value = false
    vepError.value = null
    myvariantData.value = null
    myvariantLoading.value = false
    spliceaiData.value = null
    spliceaiLoading.value = false
  }

  /**
   * Fetch all enrichment data for a variant in parallel
   */
  async function fetchVep(chr: string, pos: number, ref: string, alt: string): Promise<void> {
    if (!api) return

    // Capture current generation so we can detect if the variant changed mid-flight
    const thisGeneration = ++fetchGeneration

    // Reset state
    vepLoading.value = true
    myvariantLoading.value = true
    spliceaiLoading.value = true
    vepError.value = null
    vepData.value = null
    myvariantData.value = null
    spliceaiData.value = null

    // Fetch all APIs in parallel
    const [vepResult, myvariantResult, spliceaiResult] = await Promise.allSettled([
      api.vep.fetch(chr, pos, ref, alt),
      api.myvariant.fetch(chr, pos, ref, alt),
      api.spliceai.fetch(chr, pos, ref, alt)
    ])

    // Discard results if the variant changed while we were fetching
    if (fetchGeneration !== thisGeneration) return

    // Process VEP result
    if (vepResult.status === 'fulfilled') {
      vepData.value = vepResult.value
      if (!vepResult.value.success) {
        vepError.value = vepResult.value.error
      }
    } else {
      vepError.value = vepResult.reason?.message ?? 'VEP fetch failed'
    }
    vepLoading.value = false

    // Process myvariant result
    if (myvariantResult.status === 'fulfilled') {
      myvariantData.value = myvariantResult.value
    }
    myvariantLoading.value = false

    // Process SpliceAI result
    if (spliceaiResult.status === 'fulfilled') {
      spliceaiData.value = spliceaiResult.value
    }
    spliceaiLoading.value = false
  }

  return {
    // VEP data
    vepData,
    vepLoading,
    vepError,
    isOffline,
    isCached,
    cachedAt,
    preferredTranscript,
    allTranscripts,
    colocatedVariants,
    mostSevereConsequence,

    // MyVariant data
    myvariantData,
    myvariantLoading,
    myvariantScores,
    revelScore,
    alphamissenseScore,

    // SpliceAI data
    spliceaiData,
    spliceaiLoading,
    spliceaiScores,
    spliceaiMaxDelta,

    // Combined
    isLoading,
    error,
    fetchVep,
    clearData
  }
}
