import type { DatabaseService } from '../../database/DatabaseService'
import type { StorageWriteExecutor, StorageWriteTask } from '../write-executor'
import { globalAnnotationAuditEntries, perCaseAnnotationAuditEntries } from '../annotation-audit'

function normalizeAnnotationUpdates<T extends { starred?: boolean }>(
  updates: T
): Omit<T, 'starred'> & { starred?: number } {
  const { starred, ...rest } = updates
  return {
    ...rest,
    ...(starred !== undefined ? { starred: starred ? 1 : 0 } : {})
  }
}

function serializeAuditValue(value: unknown): string | null {
  if (value === undefined || value === null) return null
  return typeof value === 'string' ? value : JSON.stringify(value)
}

export class SqliteWriteExecutor implements StorageWriteExecutor {
  private writeTail: Promise<void> = Promise.resolve()

  constructor(private readonly databaseService: DatabaseService) {}

  execute(task: StorageWriteTask): Promise<unknown> {
    const result = this.writeTail.then(() => this.executeTask(task))
    this.writeTail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private async executeTask(task: StorageWriteTask): Promise<unknown> {
    switch (task.type) {
      case 'cases:delete':
        this.databaseService.cases.deleteCase(task.params[0])
        return undefined

      case 'case-metadata:upsert':
        return this.databaseService.metadata.upsertCaseMetadata(task.params[0], task.params[1])

      case 'case-metadata:createCohort':
        return this.databaseService.metadata.createCohortGroup(
          task.params[0].name,
          task.params[0].description
        )

      case 'case-metadata:updateCohort':
        return this.databaseService.metadata.updateCohortGroup(task.params[0], task.params[1])

      case 'case-metadata:deleteCohort':
        this.databaseService.metadata.deleteCohortGroup(task.params[0])
        return undefined

      case 'case-metadata:assignCohort':
        this.databaseService.metadata.assignCaseCohort(task.params[0], task.params[1])
        return undefined

      case 'case-metadata:removeCohort':
        this.databaseService.metadata.removeCaseCohort(task.params[0], task.params[1])
        return undefined

      case 'case-metadata:setCohorts':
        this.databaseService.metadata.setCaseCohorts(task.params[0], task.params[1])
        return undefined

      case 'case-metadata:assignHpoTerm':
        return this.databaseService.metadata.assignCaseHpoTerm(
          task.params[0],
          task.params[1],
          task.params[2]
        )

      case 'case-metadata:removeHpoTerm':
        this.databaseService.metadata.removeCaseHpoTerm(task.params[0], task.params[1])
        return undefined

      case 'case-metadata:upsertDataInfo':
        return this.databaseService.metadata.upsertCaseDataInfo(task.params[0], task.params[1])

      case 'case-metadata:upsertExternalId':
        return this.databaseService.metadata.upsertCaseExternalId(
          task.params[0],
          task.params[1],
          task.params[2]
        )

      case 'case-metadata:deleteExternalId':
        this.databaseService.metadata.deleteCaseExternalId(task.params[0], task.params[1])
        return undefined

      case 'tags:create':
        return this.databaseService.tags.createTag(task.params[0], task.params[1])

      case 'tags:update':
        return this.databaseService.tags.updateTag(task.params[0], task.params[1])

      case 'tags:delete':
        this.databaseService.tags.deleteTag(task.params[0])
        return undefined

      case 'tags:assignVariantTag':
        this.databaseService.tags.assignVariantTag(...task.params)
        return undefined

      case 'tags:removeVariantTag':
        this.databaseService.tags.removeVariantTag(...task.params)
        return undefined

      case 'tags:setVariantTags':
        this.databaseService.tags.setVariantTags(...task.params)
        return undefined

      case 'annotations:upsertGlobal':
        return this.databaseService.annotations.upsertGlobalAnnotation(
          task.params[0].chr,
          task.params[0].pos,
          task.params[0].ref,
          task.params[0].alt,
          normalizeAnnotationUpdates(task.params[1])
        )

      case 'annotations:upsertGlobalWithAudit': {
        const coords = task.params[0]
        const updates = task.params[1]
        const oldAnnotation = this.databaseService.annotations.getGlobalAnnotation(
          coords.chr,
          coords.pos,
          coords.ref,
          coords.alt
        )
        const result = this.databaseService.annotations.upsertGlobalAnnotation(
          coords.chr,
          coords.pos,
          coords.ref,
          coords.alt,
          normalizeAnnotationUpdates(updates)
        )
        for (const entry of globalAnnotationAuditEntries(
          coords,
          updates,
          oldAnnotation as Record<string, unknown> | null
        )) {
          this.databaseService.auditLog.appendEntry({
            ...entry,
            old_value: serializeAuditValue(entry.old_value),
            new_value: serializeAuditValue(entry.new_value),
            user_name: entry.user_name ?? null
          })
        }
        return result
      }

      case 'annotations:deleteGlobal':
        this.databaseService.annotations.deleteGlobalAnnotation(
          task.params[0].chr,
          task.params[0].pos,
          task.params[0].ref,
          task.params[0].alt
        )
        return undefined

      case 'annotations:upsertPerCase':
        return this.databaseService.annotations.upsertPerCaseAnnotation(
          task.params[0],
          task.params[1],
          normalizeAnnotationUpdates(task.params[2])
        )

      case 'annotations:upsertPerCaseWithAudit': {
        const [caseId, variantId, updates] = task.params
        const oldAnnotation = this.databaseService.annotations.getPerCaseAnnotation(
          caseId,
          variantId
        )
        const result = this.databaseService.annotations.upsertPerCaseAnnotation(
          caseId,
          variantId,
          normalizeAnnotationUpdates(updates)
        )
        for (const entry of perCaseAnnotationAuditEntries(
          caseId,
          variantId,
          updates,
          oldAnnotation as Record<string, unknown> | null
        )) {
          this.databaseService.auditLog.appendEntry({
            ...entry,
            old_value: serializeAuditValue(entry.old_value),
            new_value: serializeAuditValue(entry.new_value),
            user_name: entry.user_name ?? null
          })
        }
        return result
      }

      case 'annotations:deletePerCase':
        this.databaseService.annotations.deletePerCaseAnnotation(...task.params)
        return undefined

      case 'case-comments:create':
        return this.databaseService.metadata.createCaseComment(...task.params)

      case 'case-comments:update':
        return this.databaseService.metadata.updateCaseComment(...task.params)

      case 'case-comments:delete':
        this.databaseService.metadata.deleteCaseComment(task.params[0])
        return undefined

      case 'case-metrics:createDefinition':
        return this.databaseService.metadata.createMetricDefinition(...task.params)

      case 'case-metrics:upsert':
        return this.databaseService.metadata.upsertCaseMetric(...task.params)

      case 'case-metrics:delete':
        this.databaseService.metadata.deleteCaseMetric(...task.params)
        return undefined

      case 'panels:create':
        return this.databaseService.panels.createPanel(task.params[0])

      case 'panels:update':
        return this.databaseService.panels.updatePanel(task.params[0], task.params[1])

      case 'panels:delete':
        this.databaseService.panels.deletePanel(task.params[0])
        return undefined

      case 'panels:duplicate':
        return this.databaseService.panels.duplicatePanel(...task.params)

      case 'panels:setGenes':
        this.databaseService.panels.setGenes(...task.params)
        return undefined

      case 'panels:activate':
        this.databaseService.panels.activatePanel(...task.params)
        return undefined

      case 'panels:deactivate':
        this.databaseService.panels.deactivatePanel(...task.params)
        return undefined

      case 'gene-lists:create':
        return this.databaseService.geneLists.createGeneList(...task.params)

      case 'gene-lists:delete':
        this.databaseService.geneLists.deleteGeneList(task.params[0])
        return undefined

      case 'gene-lists:setGenes':
        this.databaseService.geneLists.setGeneListGenes(...task.params)
        return undefined

      case 'region-files:create':
        return this.databaseService.geneLists.createRegionFile(...task.params)

      case 'region-files:delete':
        this.databaseService.geneLists.deleteRegionFile(task.params[0])
        return undefined

      case 'region-files:importBed':
        return await this.databaseService.geneLists.importBedFile(...task.params)

      case 'presets:create':
        return this.databaseService.filterPresets.createPreset(task.params[0])

      case 'presets:update':
        return this.databaseService.filterPresets.updatePreset(...task.params)

      case 'presets:delete':
        this.databaseService.filterPresets.deletePreset(task.params[0])
        return undefined

      case 'presets:reorder':
        this.databaseService.filterPresets.reorderPresets(task.params[0])
        return undefined

      case 'analysis-groups:create':
        return this.databaseService.analysisGroups.createGroup(...task.params)

      case 'analysis-groups:update':
        return this.databaseService.analysisGroups.updateGroup(...task.params)

      case 'analysis-groups:delete':
        this.databaseService.analysisGroups.deleteGroup(task.params[0])
        return undefined

      case 'analysis-groups:addMember':
        return this.databaseService.analysisGroups.addMember(...task.params)

      case 'analysis-groups:removeMember':
        this.databaseService.analysisGroups.removeMember(...task.params)
        return undefined

      case 'audit:append':
        if (task.params[0].metadata !== undefined) {
          throw new Error('SQLite audit append does not support metadata')
        }
        this.databaseService.auditLog.appendEntry({
          ...task.params[0],
          old_value:
            task.params[0].old_value === undefined || task.params[0].old_value === null
              ? null
              : typeof task.params[0].old_value === 'string'
                ? task.params[0].old_value
                : JSON.stringify(task.params[0].old_value),
          new_value:
            task.params[0].new_value === undefined || task.params[0].new_value === null
              ? null
              : typeof task.params[0].new_value === 'string'
                ? task.params[0].new_value
                : JSON.stringify(task.params[0].new_value),
          user_name: task.params[0].user_name ?? null
        })
        return undefined

      case 'transcripts:switch':
        this.databaseService.transcripts.switchSelectedTranscript(...task.params)
        return { success: true }

      case 'transcripts:insertAndSwitch':
        this.databaseService.transcripts.insertTranscriptAndSwitch(...task.params)
        return { success: true }
    }

    const exhaustive: never = task
    throw new Error(`Unsupported storage write task: ${JSON.stringify(exhaustive)}`)
  }
}
