/**
 * Runtime sets of read/write task type strings, used by the web
 * dispatcher to decide which executor handles a given
 * `<domain>:<method>` call.
 *
 * This is a public web allowlist, not a full storage-executor mirror:
 * internal composite tasks can stay executor-only. The `satisfies`
 * clauses below still pin listed values to the executor unions.
 */
import type { StorageReadTask } from '../../main/storage/read-executor'
import type { StorageWriteTask } from '../../main/storage/write-executor'

export const READ_TASK_TYPES = [
  'cases:query',
  'cases:availableBuilds',
  'case-metadata:get',
  'case-metadata:listCohorts',
  'case-metadata:getCohortByName',
  'case-metadata:getCaseCohorts',
  'case-metadata:getHpoTerms',
  'case-metadata:getDataInfo',
  'case-metadata:listExternalIds',
  'case-metadata:distinctHpoTerms',
  'case-metadata:distinctPlatforms',
  'case-metadata:distinctExternalIdTypes',
  'case-metadata:getFullMetadata',
  'variants:typeCounts',
  'variants:typesPresent',
  'variants:geneSymbols',
  'variants:search',
  'variants:query',
  'variants:shortlist',
  'variants:columnMeta',
  'export:variants',
  'export:cohort',
  'tags:list',
  'tags:getUsageCount',
  'tags:getVariantTags',
  'annotations:getGlobal',
  'annotations:getPerCase',
  'annotations:getForVariant',
  'annotations:batchGet',
  'case-comments:list',
  'case-metrics:listDefinitions',
  'case-metrics:listForCase',
  'panels:list',
  'panels:get',
  'panels:getGenes',
  'panels:activeForCase',
  'gene-lists:list',
  'gene-lists:getGenes',
  'region-files:list',
  'presets:list',
  'analysis-groups:list',
  'analysis-groups:get',
  'analysis-groups:getForCase',
  // Alias autoroutes (variants:filterOptions, cohort:query/summary/columnMeta/
  // carriers/geneBurden, database:overview) were removed (spec P-18): they ran
  // executor tasks with raw arguments, skipping the zod validation that the
  // preload-named overrides (variants:getFilterOptions, cohort:getVariants, …)
  // apply. tests/shared/ipc/parity-manifest.test.ts fails on any served key
  // that has no manifest entry.
  // audit:getByEntity / audit:query are NOT autorouted: they are
  // admin-gated overrides in routes/audit-log.ts.
  'transcripts:list'
] as const satisfies readonly StorageReadTask['type'][]

export const WRITE_TASK_TYPES = [
  'cases:delete',
  'case-metadata:upsert',
  'case-metadata:createCohort',
  'case-metadata:updateCohort',
  'case-metadata:deleteCohort',
  'case-metadata:assignCohort',
  'case-metadata:removeCohort',
  'case-metadata:setCohorts',
  'case-metadata:assignHpoTerm',
  'case-metadata:removeHpoTerm',
  'case-metadata:upsertDataInfo',
  'case-metadata:upsertExternalId',
  'case-metadata:deleteExternalId',
  'tags:create',
  'tags:update',
  'tags:delete',
  'tags:assignVariantTag',
  'tags:removeVariantTag',
  'tags:setVariantTags',
  'annotations:upsertGlobal',
  'annotations:deleteGlobal',
  'annotations:upsertPerCase',
  'annotations:deletePerCase',
  'case-comments:create',
  'case-comments:update',
  'case-comments:delete',
  'case-metrics:createDefinition',
  'case-metrics:upsert',
  'case-metrics:delete',
  'panels:create',
  'panels:update',
  'panels:delete',
  'panels:duplicate',
  'panels:setGenes',
  'panels:activate',
  'panels:deactivate',
  'gene-lists:create',
  'gene-lists:delete',
  'gene-lists:setGenes',
  'region-files:create',
  'region-files:delete',
  'region-files:importBed',
  'presets:create',
  'presets:update',
  'presets:delete',
  'presets:reorder',
  'analysis-groups:create',
  'analysis-groups:update',
  'analysis-groups:delete',
  'analysis-groups:addMember',
  'analysis-groups:removeMember',
  'transcripts:switch',
  'transcripts:insertAndSwitch'
] as const satisfies readonly StorageWriteTask['type'][]

export const READ_TASK_TYPE_SET: ReadonlySet<StorageReadTask['type']> = new Set(READ_TASK_TYPES)
export const WRITE_TASK_TYPE_SET: ReadonlySet<StorageWriteTask['type']> = new Set(WRITE_TASK_TYPES)

export function isReadTaskType(s: string): s is StorageReadTask['type'] {
  return (READ_TASK_TYPE_SET as ReadonlySet<string>).has(s)
}

export function isWriteTaskType(s: string): s is StorageWriteTask['type'] {
  return (WRITE_TASK_TYPE_SET as ReadonlySet<string>).has(s)
}

/**
 * Map from camelCase domain (as used in `window.api.<domain>`) to
 * the kebab-case task-type prefix. Most domains are unchanged
 * (`cases`, `variants`); the ones that differ are listed here.
 */
export const DOMAIN_CAMEL_TO_KEBAB: Record<string, string> = {
  caseMetadata: 'case-metadata',
  caseComments: 'case-comments',
  caseMetrics: 'case-metrics',
  geneLists: 'gene-lists',
  geneRef: 'gene-ref',
  regionFiles: 'region-files',
  analysisGroups: 'analysis-groups',
  batchImport: 'batch-import',
  referenceServices: 'reference-services',
  audit: 'audit'
}

export function toTaskDomain(camel: string): string {
  return DOMAIN_CAMEL_TO_KEBAB[camel] ?? camel
}
