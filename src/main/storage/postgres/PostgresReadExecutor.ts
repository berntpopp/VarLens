import type { StorageReadExecutor, StorageReadTask } from '../read-executor'
import type { VariantAnnotationsResult } from '../../../shared/types/api'
import type { PostgresAuditLogRepository } from './PostgresAuditLogRepository'
import type { PostgresAvailableBuildsRepository } from './PostgresAvailableBuildsRepository'
import type { PostgresAnalysisGroupsRepository } from './PostgresAnalysisGroupsRepository'
import type { PostgresAnnotationsRepository } from './PostgresAnnotationsRepository'
import type { PostgresCaseMetadataRepository } from './PostgresCaseMetadataRepository'
import type { PostgresCasesQueryRepository } from './PostgresCasesQueryRepository'
import type { PostgresCohortRepository } from './PostgresCohortRepository'
import type { PostgresCommentsMetricsRepository } from './PostgresCommentsMetricsRepository'
import type { PostgresExportRepository } from './PostgresExportRepository'
import type { PostgresFilterPresetsRepository } from './PostgresFilterPresetsRepository'
import type { PostgresOverviewRepository } from './PostgresOverviewRepository'
import type { PostgresPanelsRepository } from './PostgresPanelsRepository'
import type { PostgresPublicAnnotationRepository } from './PostgresPublicAnnotationRepository'
import type { PostgresShortlistService } from './PostgresShortlistService'
import type { PostgresTagsRepository } from './PostgresTagsRepository'
import type { PostgresTranscriptsRepository } from './PostgresTranscriptsRepository'
import type { PostgresVariantReadRepository } from './PostgresVariantReadRepository'

interface PostgresReadExecutorRepositories {
  casesQuery: Pick<PostgresCasesQueryRepository, 'queryCases'>
  availableBuilds: Pick<PostgresAvailableBuildsRepository, 'getAvailableGenomeBuilds'>
  overview: Pick<PostgresOverviewRepository, 'getOverview'>
  export: Pick<PostgresExportRepository, 'streamVariantRows'>
  cohort: Pick<
    PostgresCohortRepository,
    | 'queryVariants'
    | 'queryVariantsWithStaleness'
    | 'getSummary'
    | 'getSummaryStatus'
    | 'getColumnMeta'
    | 'getCarriers'
    | 'getGeneBurden'
    | 'streamCohortRows'
  >
  tags: Pick<PostgresTagsRepository, 'listTags' | 'getTagUsageCount' | 'getVariantTags'>
  annotations: Pick<
    PostgresAnnotationsRepository,
    'getGlobalAnnotation' | 'getPerCaseAnnotation' | 'getAnnotationsForVariant' | 'getBatch'
  >
  publicAnnotations?: Pick<
    PostgresPublicAnnotationRepository,
    'getReferencesForVariant' | 'getBatchReferences'
  >
  commentsMetrics: Pick<
    PostgresCommentsMetricsRepository,
    'listCaseComments' | 'listMetricDefinitions' | 'listCaseMetrics'
  >
  panels: Pick<
    PostgresPanelsRepository,
    | 'listPanels'
    | 'getPanel'
    | 'getGenes'
    | 'getActivePanelsForCase'
    | 'listGeneLists'
    | 'getGeneListGenes'
    | 'listRegionFiles'
  >
  filterPresets: Pick<PostgresFilterPresetsRepository, 'listPresets'>
  shortlist: Pick<PostgresShortlistService, 'getShortlist'>
  analysisGroups: Pick<
    PostgresAnalysisGroupsRepository,
    'listGroups' | 'getGroupWithMembers' | 'getGroupForCase'
  >
  audit: Pick<PostgresAuditLogRepository, 'getByEntityKey' | 'query'>
  transcripts: Pick<PostgresTranscriptsRepository, 'list'>
  caseMetadata: Pick<
    PostgresCaseMetadataRepository,
    | 'getCaseMetadata'
    | 'listCohortGroups'
    | 'getCohortGroupByName'
    | 'getCaseCohorts'
    | 'getCaseHpoTerms'
    | 'getCaseDataInfo'
    | 'listCaseExternalIds'
    | 'getDistinctHpoTerms'
    | 'getDistinctPlatforms'
    | 'getDistinctExternalIdTypes'
    | 'getFullCaseMetadata'
  >
  variants: Pick<
    PostgresVariantReadRepository,
    | 'getVariantTypeCounts'
    | 'getVariantTypesPresent'
    | 'getGeneSymbols'
    | 'searchVariants'
    | 'queryVariants'
    | 'getFilterOptions'
    | 'getColumnMeta'
  >
}

export class PostgresReadExecutor implements StorageReadExecutor {
  constructor(private readonly repositories: PostgresReadExecutorRepositories) {}

  async execute(task: StorageReadTask): Promise<unknown> {
    switch (task.type) {
      case 'cases:query':
        return await this.repositories.casesQuery.queryCases(task.params[0])

      case 'cases:availableBuilds':
        return await this.repositories.availableBuilds.getAvailableGenomeBuilds()

      case 'case-metadata:get':
        return await this.repositories.caseMetadata.getCaseMetadata(task.params[0])

      case 'case-metadata:listCohorts':
        return await this.repositories.caseMetadata.listCohortGroups()

      case 'case-metadata:getCohortByName':
        return await this.repositories.caseMetadata.getCohortGroupByName(task.params[0])

      case 'case-metadata:getCaseCohorts':
        return await this.repositories.caseMetadata.getCaseCohorts(task.params[0])

      case 'case-metadata:getHpoTerms':
        return await this.repositories.caseMetadata.getCaseHpoTerms(task.params[0])

      case 'case-metadata:getDataInfo':
        return await this.repositories.caseMetadata.getCaseDataInfo(task.params[0])

      case 'case-metadata:listExternalIds':
        return await this.repositories.caseMetadata.listCaseExternalIds(task.params[0])

      case 'case-metadata:distinctHpoTerms':
        return await this.repositories.caseMetadata.getDistinctHpoTerms()

      case 'case-metadata:distinctPlatforms':
        return await this.repositories.caseMetadata.getDistinctPlatforms()

      case 'case-metadata:distinctExternalIdTypes':
        return await this.repositories.caseMetadata.getDistinctExternalIdTypes()

      case 'case-metadata:getFullMetadata':
        return await this.repositories.caseMetadata.getFullCaseMetadata(task.params[0])

      case 'variants:typeCounts':
        return await this.repositories.variants.getVariantTypeCounts(task.params[0])

      case 'variants:typesPresent':
        return await this.repositories.variants.getVariantTypesPresent(task.params[0])

      case 'variants:geneSymbols':
        return await this.repositories.variants.getGeneSymbols(
          task.params[0],
          task.params[1],
          task.params[2]
        )

      case 'variants:search':
        return await this.repositories.variants.searchVariants(
          task.params[0],
          task.params[1],
          task.params[2]
        )

      case 'variants:query':
        return await this.repositories.variants.queryVariants(...task.params)

      case 'variants:filterOptions':
        return await this.repositories.variants.getFilterOptions(task.params[0])

      case 'variants:shortlist':
        return await this.repositories.shortlist.getShortlist(task.params[0])

      case 'variants:columnMeta':
        return await this.repositories.variants.getColumnMeta(task.params[0], task.params[1])

      case 'cohort:query':
        return await this.repositories.cohort.queryVariantsWithStaleness(task.params[0])

      case 'cohort:summary':
        return await this.repositories.cohort.getSummary()

      case 'cohort:summaryStatus':
        return await this.repositories.cohort.getSummaryStatus()

      case 'cohort:columnMeta':
        return await this.repositories.cohort.getColumnMeta()

      case 'cohort:carriers':
        return await this.repositories.cohort.getCarriers(...task.params)

      case 'cohort:geneBurden':
        return await this.repositories.cohort.getGeneBurden()

      case 'database:overview':
        return await this.repositories.overview.getOverview()

      case 'export:variants':
        return this.repositories.export.streamVariantRows(task.params[0])

      case 'export:cohort':
        return this.repositories.cohort.streamCohortRows(task.params[0])

      case 'tags:list':
        return await this.repositories.tags.listTags()

      case 'tags:getUsageCount':
        return await this.repositories.tags.getTagUsageCount(task.params[0])

      case 'tags:getVariantTags':
        return await this.repositories.tags.getVariantTags(task.params[0], task.params[1])

      case 'annotations:getGlobal':
        return await this.repositories.annotations.getGlobalAnnotation(
          task.params[0].chr,
          task.params[0].pos,
          task.params[0].ref,
          task.params[0].alt
        )

      case 'annotations:getPerCase':
        return await this.repositories.annotations.getPerCaseAnnotation(
          task.params[0],
          task.params[1]
        )

      case 'annotations:getForVariant':
        return await this.withPublicReferences(
          await this.repositories.annotations.getAnnotationsForVariant(
            task.params[0],
            task.params[1].chr,
            task.params[1].pos,
            task.params[1].ref,
            task.params[1].alt
          ),
          task.params[1]
        )

      case 'annotations:batchGet':
        return await this.withBatchPublicReferences(
          await this.repositories.annotations.getBatch(task.params[0], task.params[1]),
          task.params[1]
        )

      case 'case-comments:list':
        return await this.repositories.commentsMetrics.listCaseComments(task.params[0])

      case 'case-metrics:listDefinitions':
        return await this.repositories.commentsMetrics.listMetricDefinitions()

      case 'case-metrics:listForCase':
        return await this.repositories.commentsMetrics.listCaseMetrics(task.params[0])

      case 'panels:list':
        return await this.repositories.panels.listPanels()

      case 'panels:get':
        return await this.repositories.panels.getPanel(task.params[0])

      case 'panels:getGenes':
        return await this.repositories.panels.getGenes(task.params[0])

      case 'panels:activeForCase':
        return await this.repositories.panels.getActivePanelsForCase(task.params[0])

      case 'gene-lists:list':
        return await this.repositories.panels.listGeneLists()

      case 'gene-lists:getGenes':
        return await this.repositories.panels.getGeneListGenes(task.params[0])

      case 'region-files:list':
        return await this.repositories.panels.listRegionFiles()

      case 'presets:list':
        return await this.repositories.filterPresets.listPresets()

      case 'analysis-groups:list':
        return await this.repositories.analysisGroups.listGroups()

      case 'analysis-groups:get':
        return await this.repositories.analysisGroups.getGroupWithMembers(task.params[0])

      case 'analysis-groups:getForCase':
        return await this.repositories.analysisGroups.getGroupForCase(task.params[0])

      case 'audit:getByEntity':
        return await this.repositories.audit.getByEntityKey(task.params[0])

      case 'audit:query':
        return await this.repositories.audit.query(task.params[0])

      case 'transcripts:list':
        return await this.repositories.transcripts.list(task.params[0])
    }

    const _exhaustive: never = task
    throw new Error(`Unhandled read task: ${JSON.stringify(_exhaustive)}`)
  }

  private async withPublicReferences(
    result: VariantAnnotationsResult,
    key: { chr: string; pos: number; ref: string; alt: string }
  ): Promise<VariantAnnotationsResult> {
    if (this.repositories.publicAnnotations === undefined) return result
    return {
      ...result,
      publicReferences: await this.repositories.publicAnnotations.getReferencesForVariant(key)
    }
  }

  private async withBatchPublicReferences(
    result: Record<string, VariantAnnotationsResult>,
    keys: Array<{ chr: string; pos: number; ref: string; alt: string }>
  ): Promise<Record<string, VariantAnnotationsResult>> {
    if (this.repositories.publicAnnotations === undefined) return result
    const publicReferences = await this.repositories.publicAnnotations.getBatchReferences(keys)
    const merged: Record<string, VariantAnnotationsResult> = { ...result }
    for (const [key, value] of Object.entries(result)) {
      merged[key] = {
        ...value,
        publicReferences: publicReferences[key] ?? { snapshots: [], variantRecords: [] }
      }
    }
    return merged
  }
}
