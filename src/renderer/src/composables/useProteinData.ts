/**
 * Protein data for a gene: UniProt mapping, then InterPro domains, the
 * AlphaFold/PDB structure and the gene structure, which need the mapping.
 * All four are queries (`queries/protein.ts`) and follow the gene passed in.
 */

import { computed, type Ref } from 'vue'
import { useQuery, useQueryCache } from '@pinia/colada'
import { queryKeys } from '../queries/keys'
import {
  geneStructureQuery,
  proteinDomainsQuery,
  proteinMappingQuery,
  proteinStructureQuery
} from '../queries/protein'
import { formatError } from '../utils/ipc-result'

const message = (error: unknown): string | null =>
  error === null ? null : formatError(error, 'Unknown error')

export function useProteinData(geneSymbol: Ref<string | null>) {
  const cache = useQueryCache()
  const mappingQuery = useQuery(() => proteinMappingQuery(geneSymbol.value))
  const mapping = computed(() => mappingQuery.data.value ?? null)

  // The rest waits for the mapping: a gene without one has nothing to show.
  const accession = computed(() => mapping.value?.uniprotAccession ?? null)
  const mappedGene = computed(() => (mapping.value === null ? null : geneSymbol.value))
  const domainsQuery = useQuery(() => proteinDomainsQuery(accession.value))
  const structureQuery = useQuery(() => proteinStructureQuery(accession.value))
  const geneQuery = useQuery(() => geneStructureQuery(mappedGene.value))

  const loading = computed(() =>
    [mappingQuery, domainsQuery, structureQuery].some((q) => q.asyncStatus.value === 'loading')
  )

  /** Fetch again whatever is shown for the current gene (the Retry button). */
  function refetch(): void {
    void cache.invalidateQueries({ key: queryKeys.proteinRoot() }).catch(() => undefined)
  }

  return {
    loading,
    error: computed(() => message(mappingQuery.error.value)),
    mapping,
    domains: computed(() => domainsQuery.data.value?.domains ?? []),
    // Without domain data the length comes from the mapping.
    proteinLength: computed(
      () => domainsQuery.data.value?.proteinLength ?? mapping.value?.proteinLength ?? 0
    ),
    structureInfo: computed(() => structureQuery.data.value ?? null),
    geneStructure: computed(() => geneQuery.data.value ?? null),
    geneStructureLoading: computed(() => geneQuery.asyncStatus.value === 'loading'),
    geneStructureError: computed(() => message(geneQuery.error.value)),
    refetch
  }
}
