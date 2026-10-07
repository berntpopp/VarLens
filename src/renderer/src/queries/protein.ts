/**
 * Protein reference data from external services (UniProt, InterPro,
 * AlphaFold/PDB, Ensembl), looked up by gene symbol or UniProt accession. A
 * lookup the service answers with `success: false` is a failed query, so its
 * message is the query's error.
 */
import { defineQueryOptions } from '@pinia/colada'

import type { ProteinApiError } from '../../../shared/types/protein'
import { unwrapIpcResult, type IpcResult } from '../../../shared/types/errors'
import { canQueryFeature, queryApi } from './gate'
import { queryKeys } from './keys'

async function found<T extends { success: true }>(
  lookup: Promise<IpcResult<T | ProteinApiError>>
): Promise<T> {
  const result = unwrapIpcResult(await lookup)
  if (!result.success) throw new Error(result.error)
  return result
}

const lookupEnabled = (id: string | null): boolean =>
  id !== null && id !== '' && canQueryFeature('proteinViewer')

export const proteinMappingQuery = defineQueryOptions((gene: string | null) => ({
  key: queryKeys.protein('mapping', gene ?? ''),
  query: async () => (await found(queryApi().protein.getMapping(gene ?? ''))).mapping,
  enabled: lookupEnabled(gene)
}))

export const geneStructureQuery = defineQueryOptions((gene: string | null) => ({
  key: queryKeys.protein('gene-structure', gene ?? ''),
  query: async () => (await found(queryApi().protein.getGeneStructure(gene ?? ''))).geneStructure,
  enabled: lookupEnabled(gene)
}))

export const proteinDomainsQuery = defineQueryOptions((accession: string | null) => ({
  key: queryKeys.protein('domains', accession ?? ''),
  query: async () => found(queryApi().protein.getDomains(accession ?? '')),
  enabled: lookupEnabled(accession)
}))

export const proteinStructureQuery = defineQueryOptions((accession: string | null) => ({
  key: queryKeys.protein('structure', accession ?? ''),
  query: async () => (await found(queryApi().protein.getStructure(accession ?? ''))).structure,
  enabled: lookupEnabled(accession)
}))
