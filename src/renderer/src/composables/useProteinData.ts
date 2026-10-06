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
import { useCapabilityStore } from '../stores/capabilityStore'
import { logService } from '../services/LogService'
import { isIpcError, unwrapIpcResult } from '../../../shared/types/errors'

export function useProteinData(geneSymbol: Ref<string | null>) {
  // protein.* / gnomad.* are gated on the proteinViewer capability (parity manifest).
  const api = useCapabilityStore().canUse('proteinViewer') ? useApiService().api : undefined

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
      const mappingResult = unwrapIpcResult(await api.protein.getMapping(gene))

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
        .then((ipcResult) => {
          if (fetchGeneration !== thisGeneration) return
          const result = unwrapIpcResult(ipcResult)
          if (result.success) {
            geneStructure.value = result.geneStructure
          } else {
            geneStructureError.value = result.error
            logService.warn(`Gene structure fetch failed: ${result.error}`, 'useProteinData')
          }
        })
        .catch((err) => {
          if (fetchGeneration !== thisGeneration) return
          geneStructureError.value =
            err instanceof Error
              ? err.message
              : isIpcError(err)
                ? (err.userMessage ?? err.message)
                : 'Unknown error'
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
      if (domainsResult.status === 'fulfilled') {
        const domainResult = unwrapIpcResult(domainsResult.value)
        if (domainResult.success) {
          domains.value = domainResult.domains
          proteinLength.value = domainResult.proteinLength
        } else {
          proteinLength.value = mappingResult.mapping.proteinLength
        }
      } else {
        // Fall back to mapping protein length
        proteinLength.value = mappingResult.mapping.proteinLength
        if (domainsResult.status === 'rejected') {
          logService.warn(`Domain fetch failed: ${domainsResult.reason}`, 'useProteinData')
        }
      }

      // Process structure
      if (structureResult.status === 'fulfilled') {
        const resolvedStructureResult = unwrapIpcResult(structureResult.value)
        if (resolvedStructureResult.success) {
          structureInfo.value = resolvedStructureResult.structure
        }
      }
    } catch (err) {
      if (fetchGeneration !== thisGeneration) return
      error.value =
        err instanceof Error
          ? err.message
          : isIpcError(err)
            ? (err.userMessage ?? err.message)
            : 'Unknown error'
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
