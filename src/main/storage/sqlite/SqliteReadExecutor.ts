import type { DatabaseService } from '../../database/DatabaseService'
import type { DbPool } from '../../database/DbPool'
import type { StorageReadExecutor, StorageReadTask } from '../read-executor'

export class SqliteReadExecutor implements StorageReadExecutor {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly dbPool: DbPool | null
  ) {}

  async execute(task: StorageReadTask): Promise<unknown> {
    switch (task.type) {
      case 'cases:query':
        if (this.dbPool !== null) {
          return await this.dbPool.run({
            type: 'cases:query',
            params: task.params
          })
        }

        return this.databaseService.cases.queryCases(task.params[0])

      case 'cases:availableBuilds':
        if (this.dbPool !== null) {
          return await this.dbPool.run({
            type: 'cases:availableBuilds',
            params: []
          })
        }

        return this.databaseService.cases.getAvailableGenomeBuilds()

      case 'case-metadata:get':
        if (this.dbPool !== null) {
          return await this.dbPool.run({ type: 'case-metadata:get', params: task.params })
        }

        return this.databaseService.metadata.getCaseMetadata(task.params[0])

      case 'case-metadata:listCohorts':
        if (this.dbPool !== null) {
          return await this.dbPool.run({ type: 'case-metadata:listCohorts', params: task.params })
        }

        return this.databaseService.metadata.listCohortGroups()

      case 'case-metadata:getCohortByName':
        if (this.dbPool !== null) {
          return await this.dbPool.run({
            type: 'case-metadata:getCohortByName',
            params: task.params
          })
        }

        return this.databaseService.metadata.getCohortGroupByName(task.params[0])

      case 'case-metadata:getCaseCohorts':
        if (this.dbPool !== null) {
          return await this.dbPool.run({
            type: 'case-metadata:getCaseCohorts',
            params: task.params
          })
        }

        return this.databaseService.metadata.getCaseCohorts(task.params[0])

      case 'case-metadata:getHpoTerms':
        if (this.dbPool !== null) {
          return await this.dbPool.run({ type: 'case-metadata:getHpoTerms', params: task.params })
        }

        return this.databaseService.metadata.getCaseHpoTerms(task.params[0])

      case 'case-metadata:getDataInfo':
        if (this.dbPool !== null) {
          return await this.dbPool.run({ type: 'case-metadata:getDataInfo', params: task.params })
        }

        return this.databaseService.metadata.getCaseDataInfo(task.params[0])

      case 'case-metadata:listExternalIds':
        if (this.dbPool !== null) {
          return await this.dbPool.run({
            type: 'case-metadata:listExternalIds',
            params: task.params
          })
        }

        return this.databaseService.metadata.listCaseExternalIds(task.params[0])

      case 'case-metadata:distinctHpoTerms':
        if (this.dbPool !== null) {
          return await this.dbPool.run({
            type: 'case-metadata:distinctHpoTerms',
            params: task.params
          })
        }

        return this.databaseService.metadata.getDistinctHpoTerms()

      case 'case-metadata:distinctPlatforms':
        if (this.dbPool !== null) {
          return await this.dbPool.run({
            type: 'case-metadata:distinctPlatforms',
            params: task.params
          })
        }

        return this.databaseService.metadata.getDistinctPlatforms()

      case 'case-metadata:distinctExternalIdTypes':
        if (this.dbPool !== null) {
          return await this.dbPool.run({
            type: 'case-metadata:distinctExternalIdTypes',
            params: task.params
          })
        }

        return this.databaseService.metadata.getDistinctExternalIdTypes()

      case 'case-metadata:getFullMetadata':
        if (this.dbPool !== null) {
          return await this.dbPool.run({
            type: 'case-metadata:getFullMetadata',
            params: task.params
          })
        }

        return this.databaseService.metadata.getFullCaseMetadata(task.params[0])

      case 'variants:typeCounts':
        if (this.dbPool !== null)
          return await this.dbPool.run({ type: task.type, params: task.params })
        return this.databaseService.variants.getVariantTypeCounts(task.params[0])

      case 'variants:typesPresent':
        if (this.dbPool !== null)
          return await this.dbPool.run({ type: task.type, params: task.params })
        return Array.from(this.databaseService.variants.getVariantTypesPresent(task.params[0]))

      case 'variants:geneSymbols':
        if (this.dbPool !== null)
          return await this.dbPool.run({ type: task.type, params: task.params })
        return this.databaseService.variants.getGeneSymbols(
          task.params[0],
          task.params[1],
          task.params[2]
        )

      case 'variants:search':
        if (this.dbPool !== null)
          return await this.dbPool.run({ type: task.type, params: task.params })
        return this.databaseService.variants.searchVariants(
          task.params[0],
          task.params[1],
          task.params[2]
        )

      case 'variants:query': {
        // SQLite has no keyset paging: drop the optional 7th (page) param.
        const [filter, limit, offset, sortBy, skipCount, includeUnfilteredCount] = task.params
        if (this.dbPool !== null)
          return await this.dbPool.run({ type: task.type, params: task.params })
        return this.databaseService.variants.getVariants(
          filter,
          limit,
          offset,
          sortBy,
          skipCount,
          includeUnfilteredCount
        )
      }

      case 'variants:filterOptions':
        if (this.dbPool !== null)
          return await this.dbPool.run({ type: task.type, params: task.params })
        return this.databaseService.variants.getFilterOptions(task.params[0])

      case 'variants:shortlist':
        return this.databaseService.shortlistService.getShortlist(task.params[0])

      case 'variants:columnMeta':
        if (this.dbPool !== null)
          return await this.dbPool.run({ type: task.type, params: task.params })
        return this.databaseService.variants.getColumnMeta(task.params[0], task.params[1])

      case 'cohort:query':
        if (this.dbPool !== null) {
          return await this.dbPool.run({ type: 'cohort:variants', params: task.params })
        }
        return this.databaseService.cohort.getCohortVariants(task.params[0])

      case 'cohort:summary':
        if (this.dbPool !== null) {
          return await this.dbPool.run({ type: 'cohort:summary', params: task.params })
        }
        return this.databaseService.cohort.getCohortSummary()

      case 'cohort:summaryStatus':
        if (this.dbPool !== null) {
          return await this.dbPool.run({ type: 'cohort:summaryStatus', params: task.params })
        }
        return this.databaseService.cohortSummary.getStatus()

      case 'cohort:columnMeta':
        if (this.dbPool !== null) {
          return await this.dbPool.run({ type: 'cohort:columnMeta', params: task.params })
        }
        return this.databaseService.cohort.getColumnMeta()

      case 'cohort:carriers':
        if (this.dbPool !== null) {
          return await this.dbPool.run({ type: 'cohort:carriers', params: task.params })
        }
        return this.databaseService.cohort.getCarriers(...task.params)

      case 'cohort:geneBurden':
        if (this.dbPool !== null) {
          return await this.dbPool.run({ type: 'cohort:geneBurden', params: task.params })
        }
        return this.databaseService.cohort.getGeneBurden()

      case 'database:overview':
        if (this.dbPool !== null)
          return await this.dbPool.run({ type: task.type, params: task.params })
        return this.databaseService.overview.getDatabaseOverview()

      case 'export:variants':
        throw new Error('SQLite export uses the dedicated export worker path')

      case 'export:cohort':
        throw new Error('SQLite cohort export uses the dedicated export worker path')

      case 'tags:list':
        if (this.dbPool !== null) return await this.dbPool.run({ type: 'tags:list', params: [] })
        return this.databaseService.tags.listTags()

      case 'tags:getUsageCount':
        if (this.dbPool !== null)
          return await this.dbPool.run({ type: 'tags:getUsageCount', params: task.params })
        return this.databaseService.tags.getTagUsageCount(task.params[0])

      case 'tags:getVariantTags':
        if (this.dbPool !== null)
          return await this.dbPool.run({ type: 'tags:getVariantTags', params: task.params })
        return this.databaseService.tags.getVariantTags(task.params[0], task.params[1])

      case 'annotations:getGlobal':
        if (this.dbPool !== null)
          return await this.dbPool.run({
            type: 'annotations:getGlobal',
            params: [task.params[0].chr, task.params[0].pos, task.params[0].ref, task.params[0].alt]
          })
        return this.databaseService.annotations.getGlobalAnnotation(
          task.params[0].chr,
          task.params[0].pos,
          task.params[0].ref,
          task.params[0].alt
        )

      case 'annotations:getPerCase':
        if (this.dbPool !== null)
          return await this.dbPool.run({ type: 'annotations:getPerCase', params: task.params })
        return this.databaseService.annotations.getPerCaseAnnotation(task.params[0], task.params[1])

      case 'annotations:getForVariant':
        return this.databaseService.annotations.getAnnotationsForVariant(
          task.params[0],
          task.params[1].chr,
          task.params[1].pos,
          task.params[1].ref,
          task.params[1].alt
        )

      case 'annotations:batchGet':
        return this.databaseService.annotations.getBatch(task.params[0], task.params[1])

      case 'case-comments:list':
        return this.databaseService.metadata.listCaseComments(task.params[0])

      case 'case-metrics:listDefinitions':
        return this.databaseService.metadata.listMetricDefinitions()

      case 'case-metrics:listForCase':
        return this.databaseService.metadata.listCaseMetrics(task.params[0])

      case 'panels:list':
        return this.databaseService.panels.listPanels()

      case 'panels:get':
        return this.databaseService.panels.getPanel(task.params[0])

      case 'panels:getGenes':
        return this.databaseService.panels.getGenes(task.params[0])

      case 'panels:activeForCase':
        return this.databaseService.panels.getActivePanelsForCase(task.params[0])

      case 'gene-lists:list':
        if (this.dbPool !== null)
          return await this.dbPool.run({ type: 'gene-lists:list', params: [] })
        return this.databaseService.geneLists.listGeneLists()

      case 'gene-lists:getGenes':
        if (this.dbPool !== null)
          return await this.dbPool.run({ type: 'gene-lists:getGenes', params: task.params })
        return this.databaseService.geneLists.getGeneListGenes(task.params[0])

      case 'region-files:list':
        if (this.dbPool !== null)
          return await this.dbPool.run({ type: 'region-files:list', params: [] })
        return this.databaseService.geneLists.listRegionFiles()

      case 'presets:list':
        return this.databaseService.filterPresets.listPresets()

      case 'analysis-groups:list':
        return this.databaseService.analysisGroups.listGroups()

      case 'analysis-groups:get':
        return this.databaseService.analysisGroups.getGroupWithMembers(task.params[0])

      case 'analysis-groups:getForCase':
        return this.databaseService.analysisGroups.getGroupForCase(task.params[0])

      case 'audit:getByEntity':
        return this.databaseService.auditLog.getByEntityKey(task.params[0])

      case 'audit:query':
        return this.databaseService.auditLog.query(task.params[0])

      case 'transcripts:list':
        return this.databaseService.transcripts.getVariantTranscripts(task.params[0])
    }

    const _exhaustive: never = task
    throw new Error(`Unhandled read task: ${JSON.stringify(_exhaustive)}`)
  }
}
