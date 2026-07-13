import type { StorageWriteExecutor, StorageWriteTask } from '../write-executor'
import type { PostgresAnalysisGroupsRepository } from './PostgresAnalysisGroupsRepository'
import type { PostgresAnnotationsRepository } from './PostgresAnnotationsRepository'
import type { PostgresAuditLogRepository } from './PostgresAuditLogRepository'
import type { PostgresCaseLifecycleRepository } from './PostgresCaseLifecycleRepository'
import type { PostgresCaseMetadataRepository } from './PostgresCaseMetadataRepository'
import type { PostgresCommentsMetricsRepository } from './PostgresCommentsMetricsRepository'
import type { PostgresFilterPresetsRepository } from './PostgresFilterPresetsRepository'
import type { PostgresPanelsRepository } from './PostgresPanelsRepository'
import type { PostgresTagsRepository } from './PostgresTagsRepository'
import type { PostgresTranscriptsRepository } from './PostgresTranscriptsRepository'

type PostgresCaseMetadataWriter = Pick<
  PostgresCaseMetadataRepository,
  | 'upsertCaseMetadata'
  | 'createCohortGroup'
  | 'updateCohortGroup'
  | 'deleteCohortGroup'
  | 'assignCaseCohort'
  | 'removeCaseCohort'
  | 'setCaseCohorts'
  | 'assignCaseHpoTerm'
  | 'removeCaseHpoTerm'
  | 'upsertCaseDataInfo'
  | 'upsertCaseExternalId'
  | 'deleteCaseExternalId'
>

function normalizeAnnotationUpdates<T extends { starred?: boolean }>(
  updates: T
): Omit<T, 'starred'> & { starred?: number } {
  const { starred, ...rest } = updates
  return {
    ...rest,
    ...(starred !== undefined ? { starred: starred ? 1 : 0 } : {})
  }
}

export class PostgresWriteExecutor implements StorageWriteExecutor {
  constructor(
    private readonly caseMetadata: PostgresCaseMetadataWriter,
    private readonly caseLifecycle: Pick<PostgresCaseLifecycleRepository, 'deleteCase'>,
    private readonly workflow: {
      audit: Pick<PostgresAuditLogRepository, 'append'>
      tags: Pick<
        PostgresTagsRepository,
        | 'createTag'
        | 'updateTag'
        | 'deleteTag'
        | 'assignVariantTag'
        | 'removeVariantTag'
        | 'setVariantTags'
      >
      annotations: Pick<
        PostgresAnnotationsRepository,
        | 'upsertGlobalAnnotation'
        | 'upsertGlobalAnnotationWithAudit'
        | 'deleteGlobalAnnotation'
        | 'upsertPerCaseAnnotation'
        | 'upsertPerCaseAnnotationWithAudit'
        | 'deletePerCaseAnnotation'
      >
      commentsMetrics: Pick<
        PostgresCommentsMetricsRepository,
        | 'createCaseComment'
        | 'updateCaseComment'
        | 'deleteCaseComment'
        | 'createMetricDefinition'
        | 'upsertCaseMetric'
        | 'deleteCaseMetric'
      >
      panels: Pick<
        PostgresPanelsRepository,
        | 'createPanel'
        | 'updatePanel'
        | 'deletePanel'
        | 'duplicatePanel'
        | 'setGenes'
        | 'activatePanel'
        | 'deactivatePanel'
        | 'createGeneList'
        | 'deleteGeneList'
        | 'setGeneListGenes'
        | 'createRegionFile'
        | 'deleteRegionFile'
        | 'importBedFile'
      >
      filterPresets: Pick<
        PostgresFilterPresetsRepository,
        'createPreset' | 'updatePreset' | 'deletePreset' | 'reorderPresets'
      >
      analysisGroups: Pick<
        PostgresAnalysisGroupsRepository,
        'createGroup' | 'updateGroup' | 'deleteGroup' | 'addMember' | 'removeMember'
      >
      transcripts: Pick<
        PostgresTranscriptsRepository,
        'switchSelectedTranscript' | 'insertTranscriptAndSwitch'
      >
    }
  ) {}

  async execute(task: StorageWriteTask): Promise<unknown> {
    switch (task.type) {
      case 'cases:delete':
        return await this.caseLifecycle.deleteCase(task.params[0])

      case 'case-metadata:upsert':
        return await this.caseMetadata.upsertCaseMetadata(task.params[0], task.params[1])

      case 'case-metadata:createCohort':
        return await this.caseMetadata.createCohortGroup(
          task.params[0].name,
          task.params[0].description
        )

      case 'case-metadata:updateCohort':
        return await this.caseMetadata.updateCohortGroup(task.params[0], task.params[1])

      case 'case-metadata:deleteCohort':
        return await this.caseMetadata.deleteCohortGroup(task.params[0])

      case 'case-metadata:assignCohort':
        return await this.caseMetadata.assignCaseCohort(task.params[0], task.params[1])

      case 'case-metadata:removeCohort':
        return await this.caseMetadata.removeCaseCohort(task.params[0], task.params[1])

      case 'case-metadata:setCohorts':
        return await this.caseMetadata.setCaseCohorts(task.params[0], task.params[1])

      case 'case-metadata:assignHpoTerm':
        return await this.caseMetadata.assignCaseHpoTerm(
          task.params[0],
          task.params[1],
          task.params[2]
        )

      case 'case-metadata:removeHpoTerm':
        return await this.caseMetadata.removeCaseHpoTerm(task.params[0], task.params[1])

      case 'case-metadata:upsertDataInfo':
        return await this.caseMetadata.upsertCaseDataInfo(task.params[0], task.params[1])

      case 'case-metadata:upsertExternalId':
        return await this.caseMetadata.upsertCaseExternalId(
          task.params[0],
          task.params[1],
          task.params[2]
        )

      case 'case-metadata:deleteExternalId':
        return await this.caseMetadata.deleteCaseExternalId(task.params[0], task.params[1])

      case 'tags:create':
        return await this.workflow.tags.createTag(task.params[0], task.params[1])

      case 'tags:update':
        return await this.workflow.tags.updateTag(task.params[0], task.params[1])

      case 'tags:delete':
        return await this.workflow.tags.deleteTag(task.params[0])

      case 'tags:assignVariantTag':
        return await this.workflow.tags.assignVariantTag(...task.params)

      case 'tags:removeVariantTag':
        return await this.workflow.tags.removeVariantTag(...task.params)

      case 'tags:setVariantTags':
        return await this.workflow.tags.setVariantTags(...task.params)

      case 'annotations:upsertGlobal':
        return await this.workflow.annotations.upsertGlobalAnnotation(
          task.params[0].chr,
          task.params[0].pos,
          task.params[0].ref,
          task.params[0].alt,
          normalizeAnnotationUpdates(task.params[1])
        )

      case 'annotations:upsertGlobalWithAudit':
        return await this.workflow.annotations.upsertGlobalAnnotationWithAudit(
          task.params[0].chr,
          task.params[0].pos,
          task.params[0].ref,
          task.params[0].alt,
          normalizeAnnotationUpdates(task.params[1])
        )

      case 'annotations:deleteGlobal':
        return await this.workflow.annotations.deleteGlobalAnnotation(
          task.params[0].chr,
          task.params[0].pos,
          task.params[0].ref,
          task.params[0].alt
        )

      case 'annotations:upsertPerCase':
        return await this.workflow.annotations.upsertPerCaseAnnotation(
          task.params[0],
          task.params[1],
          normalizeAnnotationUpdates(task.params[2])
        )

      case 'annotations:upsertPerCaseWithAudit':
        return await this.workflow.annotations.upsertPerCaseAnnotationWithAudit(
          task.params[0],
          task.params[1],
          normalizeAnnotationUpdates(task.params[2])
        )

      case 'annotations:deletePerCase':
        return await this.workflow.annotations.deletePerCaseAnnotation(...task.params)

      case 'case-comments:create':
        return await this.workflow.commentsMetrics.createCaseComment(...task.params)

      case 'case-comments:update':
        return await this.workflow.commentsMetrics.updateCaseComment(...task.params)

      case 'case-comments:delete':
        return await this.workflow.commentsMetrics.deleteCaseComment(task.params[0])

      case 'case-metrics:createDefinition':
        return await this.workflow.commentsMetrics.createMetricDefinition(...task.params)

      case 'case-metrics:upsert':
        return await this.workflow.commentsMetrics.upsertCaseMetric(...task.params)

      case 'case-metrics:delete':
        return await this.workflow.commentsMetrics.deleteCaseMetric(...task.params)

      case 'panels:create':
        return await this.workflow.panels.createPanel(task.params[0])

      case 'panels:update':
        return await this.workflow.panels.updatePanel(task.params[0], task.params[1])

      case 'panels:delete':
        return await this.workflow.panels.deletePanel(task.params[0])

      case 'panels:duplicate':
        return await this.workflow.panels.duplicatePanel(...task.params)

      case 'panels:setGenes':
        return await this.workflow.panels.setGenes(...task.params)

      case 'panels:activate':
        return await this.workflow.panels.activatePanel(...task.params)

      case 'panels:deactivate':
        return await this.workflow.panels.deactivatePanel(...task.params)

      case 'gene-lists:create':
        return await this.workflow.panels.createGeneList(...task.params)

      case 'gene-lists:delete':
        return await this.workflow.panels.deleteGeneList(task.params[0])

      case 'gene-lists:setGenes':
        return await this.workflow.panels.setGeneListGenes(...task.params)

      case 'region-files:create':
        return await this.workflow.panels.createRegionFile(...task.params)

      case 'region-files:delete':
        return await this.workflow.panels.deleteRegionFile(task.params[0])

      case 'region-files:importBed':
        return await this.workflow.panels.importBedFile(...task.params)

      case 'presets:create':
        return await this.workflow.filterPresets.createPreset(task.params[0])

      case 'presets:update':
        return await this.workflow.filterPresets.updatePreset(...task.params)

      case 'presets:delete':
        return await this.workflow.filterPresets.deletePreset(task.params[0])

      case 'presets:reorder':
        return await this.workflow.filterPresets.reorderPresets(task.params[0])

      case 'analysis-groups:create':
        return await this.workflow.analysisGroups.createGroup(...task.params)

      case 'analysis-groups:update':
        return await this.workflow.analysisGroups.updateGroup(...task.params)

      case 'analysis-groups:delete':
        return await this.workflow.analysisGroups.deleteGroup(task.params[0])

      case 'analysis-groups:addMember':
        return await this.workflow.analysisGroups.addMember(...task.params)

      case 'analysis-groups:removeMember':
        return await this.workflow.analysisGroups.removeMember(...task.params)

      case 'audit:append':
        return await this.workflow.audit.append(task.params[0])

      case 'transcripts:switch':
        return await this.workflow.transcripts.switchSelectedTranscript(...task.params)

      case 'transcripts:insertAndSwitch':
        return await this.workflow.transcripts.insertTranscriptAndSwitch(...task.params)
    }

    const exhaustive: never = task
    throw new Error(`Unsupported storage write task: ${JSON.stringify(exhaustive)}`)
  }
}
