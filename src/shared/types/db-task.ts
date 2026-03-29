/**
 * DbTask — typed task dispatched to Piscina db-worker threads.
 *
 * The `type` field is a string literal union of all valid task types,
 * providing compile-time safety against typos and invalid task names.
 * Params are untyped since they cross a structured-clone boundary
 * where TypeScript types aren't enforced at runtime.
 */

/** All valid read-only task types handled by the db-worker */
export type DbTaskType =
  // Variants
  | 'variants:query'
  | 'variants:filterOptions'
  | 'variants:search'
  | 'variants:geneSymbols'
  // Cohort
  | 'cohort:variants'
  | 'cohort:columnMeta'
  | 'cohort:summary'
  | 'cohort:carriers'
  | 'cohort:geneBurden'
  | 'cohort:summaryStatus'
  // Cases
  | 'cases:list'
  | 'cases:query'
  // Annotations
  | 'annotations:getGlobal'
  | 'annotations:getPerCase'
  | 'annotations:getForVariant'
  | 'annotations:batchGet'
  // Case metadata
  | 'case-metadata:get'
  | 'case-metadata:listCohorts'
  | 'case-metadata:getCohortByName'
  | 'case-metadata:getCaseCohorts'
  | 'case-metadata:getHpoTerms'
  | 'case-metadata:getDataInfo'
  | 'case-metadata:listExternalIds'
  | 'case-metadata:distinctPlatforms'
  | 'case-metadata:distinctExternalIdTypes'
  | 'case-metadata:distinctHpoTerms'
  | 'case-metadata:getFullMetadata'
  // Tags (read-only)
  | 'tags:list'
  | 'tags:getVariantTags'
  | 'tags:getUsageCount'
  // Transcripts (read-only)
  | 'transcripts:list'
  // Gene lists (read-only)
  | 'gene-lists:list'
  | 'gene-lists:getGenes'
  // Region files (read-only)
  | 'region-files:list'
  // Database
  | 'database:overview'
  // Association analysis
  | 'association:build'

export interface DbTask {
  /** IPC-style channel name — must be a valid DbTaskType */
  type: DbTaskType
  /** Arguments forwarded to the repository method (order-dependent) */
  params: unknown[]
}
