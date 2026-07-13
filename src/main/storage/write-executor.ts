import type {
  CohortCreateParams,
  CohortUpdateParams,
  DataInfoUpdates,
  MetadataUpdates
} from './case-metadata-types'
import type { MetricValue } from '../../shared/types/api'
import type { FilterPresetCreate, FilterPresetUpdate } from '../../shared/types/filter-presets'
import type { CreatePanelInput } from '../../shared/types/panels'
import type {
  AnalysisGroupRole,
  AffectedStatusValue,
  CommentCategory
} from '../../shared/types/database'
import type {
  GlobalAnnotationUpdates,
  PerCaseAnnotationUpdates,
  VariantCoords
} from '../ipc/handlers/annotations-logic'
import type { AuditAppendParams } from './audit-log-types'
import type { TranscriptInsertRow } from '../../shared/types/transcript'

export type StorageWriteTask =
  | { type: 'cases:delete'; params: [caseId: number] }
  | { type: 'case-metadata:upsert'; params: [caseId: number, updates: MetadataUpdates] }
  | { type: 'case-metadata:createCohort'; params: [params: CohortCreateParams] }
  | {
      type: 'case-metadata:updateCohort'
      params: [cohortId: number, updates: CohortUpdateParams]
    }
  | { type: 'case-metadata:deleteCohort'; params: [cohortId: number] }
  | { type: 'case-metadata:assignCohort'; params: [caseId: number, cohortId: number] }
  | { type: 'case-metadata:removeCohort'; params: [caseId: number, cohortId: number] }
  | { type: 'case-metadata:setCohorts'; params: [caseId: number, cohortIds: number[]] }
  | {
      type: 'case-metadata:assignHpoTerm'
      params: [caseId: number, hpoId: string, hpoLabel: string]
    }
  | { type: 'case-metadata:removeHpoTerm'; params: [caseId: number, hpoId: string] }
  | { type: 'case-metadata:upsertDataInfo'; params: [caseId: number, updates: DataInfoUpdates] }
  | {
      type: 'case-metadata:upsertExternalId'
      params: [caseId: number, idType: string, idValue: string]
    }
  | { type: 'case-metadata:deleteExternalId'; params: [caseId: number, idType: string] }
  | { type: 'tags:create'; params: [name: string, color: string] }
  | { type: 'tags:update'; params: [id: number, updates: { name?: string; color?: string }] }
  | { type: 'tags:delete'; params: [id: number] }
  | { type: 'tags:assignVariantTag'; params: [caseId: number, variantId: number, tagId: number] }
  | { type: 'tags:removeVariantTag'; params: [caseId: number, variantId: number, tagId: number] }
  | { type: 'tags:setVariantTags'; params: [caseId: number, variantId: number, tagIds: number[]] }
  | {
      type: 'annotations:upsertGlobal'
      params: [coords: VariantCoords, updates: GlobalAnnotationUpdates]
    }
  | {
      type: 'annotations:upsertGlobalWithAudit'
      params: [coords: VariantCoords, updates: GlobalAnnotationUpdates]
    }
  | { type: 'annotations:deleteGlobal'; params: [coords: VariantCoords] }
  | {
      type: 'annotations:upsertPerCase'
      params: [caseId: number, variantId: number, updates: PerCaseAnnotationUpdates]
    }
  | {
      type: 'annotations:upsertPerCaseWithAudit'
      params: [caseId: number, variantId: number, updates: PerCaseAnnotationUpdates]
    }
  | { type: 'annotations:deletePerCase'; params: [caseId: number, variantId: number] }
  | {
      type: 'case-comments:create'
      params: [caseId: number, category: CommentCategory, content: string]
    }
  | { type: 'case-comments:update'; params: [commentId: number, content: string] }
  | { type: 'case-comments:delete'; params: [commentId: number] }
  | {
      type: 'case-metrics:createDefinition'
      params: [name: string, valueType: 'numeric' | 'text' | 'date', unit: string, category: string]
    }
  | { type: 'case-metrics:upsert'; params: [caseId: number, metricId: number, value: MetricValue] }
  | { type: 'case-metrics:delete'; params: [caseId: number, metricId: number] }
  | { type: 'panels:create'; params: [input: CreatePanelInput] }
  | {
      type: 'panels:update'
      params: [
        panelId: number,
        updates: { name?: string; description?: string | null; version?: string | null }
      ]
    }
  | { type: 'panels:delete'; params: [panelId: number] }
  | { type: 'panels:duplicate'; params: [panelId: number, newName: string] }
  | {
      type: 'panels:setGenes'
      params: [panelId: number, genes: Array<{ hgncId: string; symbol: string }>]
    }
  | { type: 'panels:activate'; params: [caseId: number, panelId: number, paddingBp: number] }
  | { type: 'panels:deactivate'; params: [caseId: number, panelId: number] }
  | { type: 'gene-lists:create'; params: [name: string, description?: string | null] }
  | { type: 'gene-lists:delete'; params: [listId: number] }
  | { type: 'gene-lists:setGenes'; params: [listId: number, genes: string[]] }
  | { type: 'region-files:create'; params: [name: string, description: string | null] }
  | { type: 'region-files:delete'; params: [fileId: number] }
  | {
      type: 'region-files:importBed'
      params: [fileId: number, filePath: string, options: { rejectMalformedRows: boolean }]
    }
  | { type: 'presets:create'; params: [params: FilterPresetCreate] }
  | { type: 'presets:update'; params: [id: number, updates: FilterPresetUpdate] }
  | { type: 'presets:delete'; params: [id: number] }
  | { type: 'presets:reorder'; params: [items: { id: number; sortOrder: number }[]] }
  | {
      type: 'analysis-groups:create'
      params: [name: string, groupType: 'family' | 'tumor_normal', description?: string]
    }
  | {
      type: 'analysis-groups:update'
      params: [id: number, updates: { name?: string; description?: string | null }]
    }
  | { type: 'analysis-groups:delete'; params: [id: number] }
  | {
      type: 'analysis-groups:addMember'
      params: [
        groupId: number,
        caseId: number,
        role: AnalysisGroupRole,
        affectedStatus: AffectedStatusValue,
        individualId?: string
      ]
    }
  | { type: 'analysis-groups:removeMember'; params: [groupId: number, caseId: number] }
  | { type: 'audit:append'; params: [params: AuditAppendParams] }
  | { type: 'transcripts:switch'; params: [variantId: number, transcriptId: string] }
  | {
      type: 'transcripts:insertAndSwitch'
      params: [variantId: number, transcript: TranscriptInsertRow]
    }

export interface StorageWriteExecutor {
  execute(task: StorageWriteTask): Promise<unknown>
}
