/**
 * Composable for orchestrating protein data fetching
 *
 * Fetches UniProt mapping, InterPro domains, and AlphaFold/PDB structure info
 * for a given gene symbol. Uses generation counter to discard stale results.
 */

import { ref, watch, type Ref } from 'vue'
import type {
  ProteinMapping,
  ProteinDomain,
  ProteinStructureInfo,
  GeneStructure
} from '../../../shared/types/protein'
import { useApiService } from './useApiService'
import { logService } from '../services/LogService'

export function useProteinData(geneSymbol: Ref<string | null>) {
  const { api } = useApiService()

  const loading = ref(false)
  const error = ref<string | null>(null)
  const mapping = ref<ProteinMapping | null>(null)
  const domains = ref<ProteinDomain[]>([])
  const proteinLength = ref<number>(0)
  const structureInfo = ref<ProteinStructureInfo | null>(null)
  const geneStructure = ref<GeneStructure | null>(null)
  const geneStructureLoading = ref(false)
  const geneStructureError = ref<string | null>(null)

  /** Generation counter to discard stale async results */
  let fetchGeneration = 0

  async function fetchData(gene: string): Promise<void> {
    if (!api) return

    const thisGeneration = ++fetchGeneration

    loading.value = true
    error.value = null
    mapping.value = null
    domains.value = []
    proteinLength.value = 0
    structureInfo.value = null
    geneStructure.value = null
    geneStructureLoading.value = false
    geneStructureError.value = null

    try {
      // Step 1: Get UniProt mapping
      const mappingResult = await api.protein.getMapping(gene)

      if (fetchGeneration !== thisGeneration) return

      if (!mappingResult.success) {
        error.value = mappingResult.error
        loading.value = false
        return
      }

      mapping.value = mappingResult.mapping
      const accession = mappingResult.mapping.uniprotAccession

      // Fetch gene structure in parallel (doesn't need UniProt accession)
      geneStructureLoading.value = true
      api.protein
        .getGeneStructure(gene)
        .then((result) => {
          if (fetchGeneration !== thisGeneration) return
          if (result.success) {
            geneStructure.value = result.geneStructure
          } else {
            geneStructureError.value = result.error
            logService.warn(`Gene structure fetch failed: ${result.error}`, 'useProteinData')
          }
        })
        .catch((err) => {
          if (fetchGeneration !== thisGeneration) return
          geneStructureError.value = err instanceof Error ? err.message : 'Unknown error'
        })
        .finally(() => {
          if (fetchGeneration === thisGeneration) {
            geneStructureLoading.value = false
          }
        })

      // Step 2: Fetch domains and structure in parallel
      const [domainsResult, structureResult] = await Promise.allSettled([
        api.protein.getDomains(accession),
        api.protein.getStructure(accession)
      ])

      if (fetchGeneration !== thisGeneration) return

      // Process domains
      if (domainsResult.status === 'fulfilled' && domainsResult.value.success) {
        domains.value = domainsResult.value.domains
        proteinLength.value = domainsResult.value.proteinLength
      } else {
        // Fall back to mapping protein length
        proteinLength.value = mappingResult.mapping.proteinLength
        if (domainsResult.status === 'rejected') {
          logService.warn(`Domain fetch failed: ${domainsResult.reason}`, 'useProteinData')
        }
      }

      // Process structure
      if (structureResult.status === 'fulfilled' && structureResult.value.success) {
        structureInfo.value = structureResult.value.structure
      }
    } catch (err) {
      if (fetchGeneration !== thisGeneration) return
      error.value = err instanceof Error ? err.message : 'Unknown error'
    } finally {
      if (fetchGeneration === thisGeneration) {
        loading.value = false
      }
    }
  }

  /** Re-fetch data for the current gene */
  function refetch(): void {
    if (geneSymbol.value !== null && geneSymbol.value !== '') {
      fetchData(geneSymbol.value)
    }
  }

  // Watch gene symbol changes
  watch(
    geneSymbol,
    (newGene) => {
      if (newGene !== null && newGene !== '') {
        fetchData(newGene)
      } else {
        fetchGeneration++
        loading.value = false
        error.value = null
        mapping.value = null
        domains.value = []
        proteinLength.value = 0
        structureInfo.value = null
        geneStructure.value = null
        geneStructureLoading.value = false
        geneStructureError.value = null
      }
    },
    { immediate: true }
  )

  return {
    loading,
    error,
    mapping,
    domains,
    proteinLength,
    structureInfo,
    geneStructure,
    geneStructureLoading,
    geneStructureError,
    refetch
  }
}
