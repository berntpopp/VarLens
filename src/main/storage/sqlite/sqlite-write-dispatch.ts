/**
 * SQLite write-task dispatch shared by the write worker (production) and the
 * in-process fallback used by unit tests. Every `StorageWriteTask` maps to one
 * repository call (plus audit rows for the `*WithAudit` variants).
 */
import type { Repositories } from '../../database/createRepositories'
import type { StorageWriteTask } from '../write-executor'
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

/** The repositories a write task may touch (DatabaseService exposes the same getters). */
export type SqliteWriteRepositories = Pick<
  Repositories,
  | 'cases'
  | 'metadata'
  | 'tags'
  | 'annotations'
  | 'auditLog'
  | 'panels'
  | 'geneLists'
  | 'filterPresets'
  | 'analysisGroups'
  | 'transcripts'
>

export async function executeSqliteWriteTask(
  repos: SqliteWriteRepositories,
  task: StorageWriteTask
): Promise<unknown> {
  switch (task.type) {
    case 'cases:delete':
      // Only the session batch import replaces a case; SQLite imports through its worker.
      if (task.params[1]) throw new Error('cases:delete with a successor needs PostgreSQL')
      repos.cases.deleteCase(task.params[0])
      return undefined

    case 'case-metadata:upsert':
      return repos.metadata.upsertCaseMetadata(task.params[0], task.params[1])

    case 'case-metadata:createCohort':
      return repos.metadata.createCohortGroup(task.params[0].name, task.params[0].description)

    case 'case-metadata:updateCohort':
      return repos.metadata.updateCohortGroup(task.params[0], task.params[1])

    case 'case-metadata:deleteCohort':
      repos.metadata.deleteCohortGroup(task.params[0])
      return undefined

    case 'case-metadata:assignCohort':
      repos.metadata.assignCaseCohort(task.params[0], task.params[1])
      return undefined

    case 'case-metadata:removeCohort':
      repos.metadata.removeCaseCohort(task.params[0], task.params[1])
      return undefined

    case 'case-metadata:setCohorts':
      repos.metadata.setCaseCohorts(task.params[0], task.params[1])
      return undefined

    case 'case-metadata:assignHpoTerm':
      return repos.metadata.assignCaseHpoTerm(task.params[0], task.params[1], task.params[2])

    case 'case-metadata:removeHpoTerm':
      repos.metadata.removeCaseHpoTerm(task.params[0], task.params[1])
      return undefined

    case 'case-metadata:upsertDataInfo':
      return repos.metadata.upsertCaseDataInfo(task.params[0], task.params[1])

    case 'case-metadata:upsertExternalId':
      return repos.metadata.upsertCaseExternalId(task.params[0], task.params[1], task.params[2])

    case 'case-metadata:deleteExternalId':
      repos.metadata.deleteCaseExternalId(task.params[0], task.params[1])
      return undefined

    case 'tags:create':
      return repos.tags.createTag(task.params[0], task.params[1])

    case 'tags:update':
      return repos.tags.updateTag(task.params[0], task.params[1])

    case 'tags:delete':
      repos.tags.deleteTag(task.params[0])
      return undefined

    case 'tags:assignVariantTag':
      repos.tags.assignVariantTag(...task.params)
      return undefined

    case 'tags:removeVariantTag':
      repos.tags.removeVariantTag(...task.params)
      return undefined

    case 'tags:setVariantTags':
      repos.tags.setVariantTags(...task.params)
      return undefined

    case 'annotations:upsertGlobal':
      return repos.annotations.upsertGlobalAnnotation(
        task.params[0].chr,
        task.params[0].pos,
        task.params[0].ref,
        task.params[0].alt,
        normalizeAnnotationUpdates(task.params[1])
      )

    case 'annotations:upsertGlobalWithAudit': {
      const coords = task.params[0]
      const updates = task.params[1]
      const oldAnnotation = repos.annotations.getGlobalAnnotation(
        coords.chr,
        coords.pos,
        coords.ref,
        coords.alt
      )
      const result = repos.annotations.upsertGlobalAnnotation(
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
        repos.auditLog.appendEntry({
          ...entry,
          old_value: serializeAuditValue(entry.old_value),
          new_value: serializeAuditValue(entry.new_value),
          user_name: entry.user_name ?? null
        })
      }
      return result
    }

    case 'annotations:deleteGlobal':
      repos.annotations.deleteGlobalAnnotation(
        task.params[0].chr,
        task.params[0].pos,
        task.params[0].ref,
        task.params[0].alt
      )
      return undefined

    case 'annotations:upsertPerCase':
      return repos.annotations.upsertPerCaseAnnotation(
        task.params[0],
        task.params[1],
        normalizeAnnotationUpdates(task.params[2])
      )

    case 'annotations:upsertPerCaseWithAudit': {
      const [caseId, variantId, updates] = task.params
      const oldAnnotation = repos.annotations.getPerCaseAnnotation(caseId, variantId)
      const result = repos.annotations.upsertPerCaseAnnotation(
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
        repos.auditLog.appendEntry({
          ...entry,
          old_value: serializeAuditValue(entry.old_value),
          new_value: serializeAuditValue(entry.new_value),
          user_name: entry.user_name ?? null
        })
      }
      return result
    }

    case 'annotations:deletePerCase':
      repos.annotations.deletePerCaseAnnotation(...task.params)
      return undefined

    case 'case-comments:create':
      return repos.metadata.createCaseComment(...task.params)

    case 'case-comments:update':
      return repos.metadata.updateCaseComment(...task.params)

    case 'case-comments:delete':
      repos.metadata.deleteCaseComment(task.params[0])
      return undefined

    case 'case-metrics:createDefinition':
      return repos.metadata.createMetricDefinition(...task.params)

    case 'case-metrics:upsert':
      return repos.metadata.upsertCaseMetric(...task.params)

    case 'case-metrics:delete':
      repos.metadata.deleteCaseMetric(...task.params)
      return undefined

    case 'panels:create':
      return repos.panels.createPanel(task.params[0])

    case 'panels:update':
      return repos.panels.updatePanel(task.params[0], task.params[1])

    case 'panels:delete':
      repos.panels.deletePanel(task.params[0])
      return undefined

    case 'panels:duplicate':
      return repos.panels.duplicatePanel(...task.params)

    case 'panels:setGenes':
      repos.panels.setGenes(...task.params)
      return undefined

    case 'panels:activate':
      repos.panels.activatePanel(...task.params)
      return undefined

    case 'panels:deactivate':
      repos.panels.deactivatePanel(...task.params)
      return undefined

    case 'gene-lists:create':
      return repos.geneLists.createGeneList(...task.params)

    case 'gene-lists:delete':
      repos.geneLists.deleteGeneList(task.params[0])
      return undefined

    case 'gene-lists:setGenes':
      repos.geneLists.setGeneListGenes(...task.params)
      return undefined

    case 'region-files:create':
      return repos.geneLists.createRegionFile(...task.params)

    case 'region-files:delete':
      repos.geneLists.deleteRegionFile(task.params[0])
      return undefined

    case 'region-files:importBed':
      return await repos.geneLists.importBedFile(...task.params)

    case 'presets:create':
      return repos.filterPresets.createPreset(task.params[0])

    case 'presets:update':
      return repos.filterPresets.updatePreset(...task.params)

    case 'presets:delete':
      repos.filterPresets.deletePreset(task.params[0])
      return undefined

    case 'presets:reorder':
      repos.filterPresets.reorderPresets(task.params[0])
      return undefined

    case 'analysis-groups:create':
      return repos.analysisGroups.createGroup(...task.params)

    case 'analysis-groups:update':
      return repos.analysisGroups.updateGroup(...task.params)

    case 'analysis-groups:delete':
      repos.analysisGroups.deleteGroup(task.params[0])
      return undefined

    case 'analysis-groups:addMember':
      return repos.analysisGroups.addMember(...task.params)

    case 'analysis-groups:removeMember':
      repos.analysisGroups.removeMember(...task.params)
      return undefined

    case 'audit:append':
      if (task.params[0].metadata !== undefined) {
        throw new Error('SQLite audit append does not support metadata')
      }
      repos.auditLog.appendEntry({
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

    // `cohortSummaryStale` is for the transport (transcripts-logic.ts), which
    // tells the renderer and keeps it out of the IPC result.
    case 'transcripts:switch':
      return { success: true, ...repos.transcripts.switchSelectedTranscript(...task.params) }

    case 'transcripts:insertAndSwitch':
      return { success: true, ...repos.transcripts.insertTranscriptAndSwitch(...task.params) }
  }

  const exhaustive: never = task
  throw new Error(`Unsupported storage write task: ${JSON.stringify(exhaustive)}`)
}
