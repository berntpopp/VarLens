import type { SortItem, VariantFilter } from '../../shared/types/database'
import type { VariantPageRequest } from '../../shared/types/variant-paging'
import type { CohortSearchParams } from '../../shared/types/cohort'
import type { PanelResolutionRequest } from '../../shared/types/panels'
import type { ValidatedCaseSearchParams } from '../../shared/types/ipc-schemas'
import type { VariantCoords, VariantKey } from '../ipc/handlers/annotations-logic'
import type { AuditQueryParams } from './audit-log-types'
import type { GetShortlistParams } from '../database/ShortlistService'

export type { AvailableBuild } from '../../shared/types/database'

export type StorageReadTask =
  | {
      type: 'cases:query'
      params: [params: ValidatedCaseSearchParams]
    }
  | {
      type: 'cases:availableBuilds'
      params: []
    }
  | { type: 'case-metadata:get'; params: [caseId: number] }
  | { type: 'case-metadata:listCohorts'; params: [] }
  | { type: 'case-metadata:getCohortByName'; params: [name: string] }
  | { type: 'case-metadata:getCaseCohorts'; params: [caseId: number] }
  | { type: 'case-metadata:getHpoTerms'; params: [caseId: number] }
  | { type: 'case-metadata:getDataInfo'; params: [caseId: number] }
  | { type: 'case-metadata:listExternalIds'; params: [caseId: number] }
  | { type: 'case-metadata:distinctHpoTerms'; params: [] }
  | { type: 'case-metadata:distinctPlatforms'; params: [] }
  | { type: 'case-metadata:distinctExternalIdTypes'; params: [] }
  | { type: 'case-metadata:getFullMetadata'; params: [caseId: number] }
  | { type: 'variants:typeCounts'; params: [caseId: number] }
  | {
      type: 'variants:typesPresent'
      params: [scope: { caseId: number } | { caseIds: number[] }]
    }
  | { type: 'variants:geneSymbols'; params: [caseId: number, query: string, limit: number] }
  | { type: 'variants:search'; params: [caseId: number, query: string, limit: number] }
  | {
      type: 'variants:query'
      params: [
        filter: VariantFilter,
        limit: number,
        offset: number,
        sortBy: SortItem[] | undefined,
        skipCount: boolean,
        includeUnfilteredCount: boolean,
        /** Keyset paging hint (Postgres only; SQLite ignores it). */
        page?: VariantPageRequest
      ]
    }
  | { type: 'variants:filterOptions'; params: [caseId: number] }
  | { type: 'variants:shortlist'; params: [params: GetShortlistParams] }
  | {
      type: 'variants:columnMeta'
      params: [scope: { caseId: number } | { caseIds: number[] }, columnKey: string]
    }
  | { type: 'cohort:query'; params: [params: CohortSearchParams] }
  | { type: 'cohort:summary'; params: [] }
  | { type: 'cohort:summaryStatus'; params: [] }
  | { type: 'cohort:columnMeta'; params: [] }
  | { type: 'cohort:carriers'; params: [chr: string, pos: number, ref: string, alt: string] }
  | { type: 'cohort:geneBurden'; params: [] }
  | { type: 'database:overview'; params: [] }
  | { type: 'export:variants'; params: [filter: VariantFilter] }
  | { type: 'export:cohort'; params: [params: CohortSearchParams] }
  | { type: 'tags:list'; params: [] }
  | { type: 'tags:getUsageCount'; params: [tagId: number] }
  | { type: 'tags:getVariantTags'; params: [caseId: number, variantId: number] }
  | { type: 'annotations:getGlobal'; params: [coords: VariantCoords] }
  | { type: 'annotations:getPerCase'; params: [caseId: number, variantId: number] }
  | {
      type: 'annotations:getForVariant'
      params: [caseId: number, coords: VariantCoords]
    }
  | {
      type: 'annotations:batchGet'
      params: [caseId: number | null, variantKeys: VariantKey[]]
    }
  | { type: 'case-comments:list'; params: [caseId: number] }
  | { type: 'case-metrics:listDefinitions'; params: [] }
  | { type: 'case-metrics:listForCase'; params: [caseId: number] }
  | { type: 'panels:list'; params: [] }
  | { type: 'panels:get'; params: [panelId: number] }
  | { type: 'panels:getGenes'; params: [panelId: number] }
  | { type: 'panels:activeForCase'; params: [caseId: number] }
  | { type: 'panels:resolutionStatus'; params: [request: PanelResolutionRequest] }
  | { type: 'gene-lists:list'; params: [] }
  | { type: 'gene-lists:getGenes'; params: [listId: number] }
  | { type: 'region-files:list'; params: [] }
  | { type: 'presets:list'; params: [] }
  | { type: 'analysis-groups:list'; params: [] }
  | { type: 'analysis-groups:get'; params: [groupId: number] }
  | { type: 'analysis-groups:getForCase'; params: [caseId: number] }
  | { type: 'audit:getByEntity'; params: [entityKey: string] }
  | { type: 'audit:query'; params: [params: AuditQueryParams] }
  | { type: 'transcripts:list'; params: [variantId: number] }

export interface StorageReadExecutor {
  execute(task: StorageReadTask): Promise<unknown>
}
