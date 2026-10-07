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

import { computed, nextTick, shallowRef } from 'vue'
import { useQuery } from '@pinia/colada'
import type { MyVariantScores, SpliceAIScores } from '../../../shared/types/api-enrichment'
import type { VepTranscriptConsequence, VepColocatedVariant } from '../../../shared/types/vep'
import {
  myvariantQuery,
  spliceaiQuery,
  vepQuery,
  type EnrichmentTarget
} from '../queries/enrichment'
import { canQueryFeature } from '../queries/gate'
import { useCapabilityStore } from '../stores/capabilityStore'
import { formatError } from '../utils/ipc-result'

export function useVepEnrichment() {
  // VEP / MyVariant / SpliceAI are external lookups, `pending` in web until the
  // admin egress policy lands (parity manifest): a disabled provider is skipped.
  const capabilities = useCapabilityStore()

  /** The variant the user asked to annotate; nothing is fetched before that. */
  const requested = shallowRef<EnrichmentTarget | null>(null)
  const vep = useQuery(() => vepQuery(requested.value))
  const myvariant = useQuery(() => myvariantQuery(requested.value))
  const spliceai = useQuery(() => spliceaiQuery(requested.value))

  const vepData = computed(() => vep.data.value ?? null)
  // A failing MyVariant or SpliceAI lookup only leaves its scores empty.
  const myvariantData = computed(() => myvariant.data.value ?? null)
  const spliceaiData = computed(() => spliceai.data.value ?? null)

  const vepLoading = computed(() => vep.asyncStatus.value === 'loading')
  const myvariantLoading = computed(() => myvariant.asyncStatus.value === 'loading')
  const spliceaiLoading = computed(() => spliceai.asyncStatus.value === 'loading')
  const isLoading = computed(
    () => vepLoading.value || myvariantLoading.value || spliceaiLoading.value
  )

  const vepError = computed<string | null>(() => {
    if (requested.value === null) return null
    const unavailable = capabilities.capabilityReason('vepEnrichment')
    if (unavailable !== null) return unavailable
    if (vep.error.value !== null) return formatError(vep.error.value, 'VEP fetch failed')
    return vepData.value !== null && !vepData.value.success ? vepData.value.error : null
  })
  const error = vepError

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

  /** Forget the request (call on variant change); a late answer is not shown. */
  function clearData(): void {
    requested.value = null
  }

  /** Annotate a variant with every enabled provider; resolves when all are done. */
  async function fetchVep(chr: string, pos: number, ref: string, alt: string): Promise<void> {
    const target = { chr, pos, ref, alt }
    requested.value = target
    await nextTick()
    if (requested.value !== target) return
    // An explicit refresh ignores `enabled`, so the gates are checked here too.
    await Promise.all([
      canQueryFeature('vepEnrichment') && vep.refresh(),
      canQueryFeature('myvariantEnrichment') && myvariant.refresh(),
      canQueryFeature('spliceaiEnrichment') && spliceai.refresh()
    ])
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
