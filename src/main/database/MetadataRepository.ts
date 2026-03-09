import { BaseRepository } from './BaseRepository'
import type {
  CaseMetadata,
  CaseDataInfo,
  CaseDataInfoUpdates,
  CaseExternalId,
  CohortGroup,
  CaseHpoTerm,
  CaseComment,
  CommentCategory,
  MetricDefinition,
  CaseMetric,
  CaseMetricWithDefinition
} from './types'
import { DatabaseError, NotFoundError, UniqueConstraintError } from './errors'

export class MetadataRepository extends BaseRepository {
  getCaseMetadata(caseId: number): CaseMetadata | null {
    const result = this.execFirst<CaseMetadata>(
      this.kysely.selectFrom('case_metadata').selectAll().where('case_id', '=', caseId)
    )
    return result ?? null
  }

  upsertCaseMetadata(
    caseId: number,
    updates: {
      affected_status?: string | null
      sex?: string | null
      notes?: string | null
      age?: number | null
      date_of_birth?: string | null
    }
  ): CaseMetadata {
    return this.runTransaction(() => {
      const now = Date.now()
      const fields = ['affected_status', 'sex', 'notes', 'age', 'date_of_birth'] as const

      // Try INSERT first, then UPDATE on conflict
      const existing = this.execFirst<CaseMetadata>(
        this.kysely.selectFrom('case_metadata').selectAll().where('case_id', '=', caseId)
      )

      if (existing === undefined) {
        return this.execFirst<CaseMetadata>(
          this.kysely
            .insertInto('case_metadata')
            .values({
              case_id: caseId,
              affected_status: updates.affected_status ?? null,
              sex: updates.sex ?? null,
              notes: updates.notes ?? null,
              age: updates.age ?? null,
              date_of_birth: updates.date_of_birth ?? null,
              created_at: now,
              updated_at: now
            })
            .returningAll()
        ) as CaseMetadata
      }

      // Build dynamic update object from explicitly provided fields
      const updateObj: Record<string, string | number | null> = { updated_at: now }
      for (const field of fields) {
        if (field in updates) {
          updateObj[field] = updates[field] ?? null
        }
      }
      return this.execFirst<CaseMetadata>(
        this.kysely
          .updateTable('case_metadata')
          .set(updateObj)
          .where('case_id', '=', caseId)
          .returningAll()
      ) as CaseMetadata
    })
  }

  listCohortGroups(): CohortGroup[] {
    return this.execAll<CohortGroup>(
      this.kysely.selectFrom('cohort_groups').selectAll().orderBy('name')
    )
  }

  createCohortGroup(name: string, description?: string | null): CohortGroup {
    const now = Date.now()
    return this.execFirst<CohortGroup>(
      this.kysely
        .insertInto('cohort_groups')
        .values({ name, description: description ?? null, created_at: now })
        .returningAll()
    ) as CohortGroup
  }

  updateCohortGroup(
    id: number,
    updates: { name?: string; description?: string | null }
  ): CohortGroup {
    try {
      const existing = this.execFirst<CohortGroup>(
        this.kysely.selectFrom('cohort_groups').selectAll().where('id', '=', id)
      )
      if (!existing) throw new NotFoundError('CohortGroup', id)

      const updateObj: Record<string, string | number | null> = {}
      if (updates.name !== undefined) updateObj.name = updates.name
      if (updates.description !== undefined) updateObj.description = updates.description

      if (Object.keys(updateObj).length === 0) return existing

      return this.execFirst<CohortGroup>(
        this.kysely.updateTable('cohort_groups').set(updateObj).where('id', '=', id).returningAll()
      ) as CohortGroup
    } catch (error) {
      if (error instanceof NotFoundError) throw error
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed') === true) {
        throw new UniqueConstraintError('name', updates.name ?? '')
      }
      throw new DatabaseError(
        `Failed to update cohort group: ${id}`,
        error instanceof Error ? error : undefined
      )
    }
  }

  deleteCohortGroup(cohortId: number): void {
    this.execRun(this.kysely.deleteFrom('cohort_groups').where('id', '=', cohortId))
  }

  getCohortGroupByName(name: string): CohortGroup | null {
    const result = this.execFirst<CohortGroup>(
      this.kysely.selectFrom('cohort_groups').selectAll().where('name', '=', name)
    )
    return result ?? null
  }

  getCaseCohorts(caseId: number): CohortGroup[] {
    return this.execAll<CohortGroup>(
      this.kysely
        .selectFrom('cohort_groups as cg')
        .innerJoin('case_cohort_links as ccl', 'cg.id', 'ccl.cohort_id')
        .selectAll('cg')
        .where('ccl.case_id', '=', caseId)
        .orderBy('cg.name')
    )
  }

  assignCaseCohort(caseId: number, cohortId: number): void {
    this.execRun(
      this.kysely
        .insertInto('case_cohort_links')
        .values({ case_id: caseId, cohort_id: cohortId })
        .onConflict((oc) => oc.doNothing())
    )
  }

  removeCaseCohort(caseId: number, cohortId: number): void {
    this.execRun(
      this.kysely
        .deleteFrom('case_cohort_links')
        .where('case_id', '=', caseId)
        .where('cohort_id', '=', cohortId)
    )
  }

  setCaseCohorts(caseId: number, cohortIds: number[]): void {
    this.runTransaction(() => {
      this.execRun(this.kysely.deleteFrom('case_cohort_links').where('case_id', '=', caseId))
      for (const cohortId of cohortIds) {
        this.execRun(
          this.kysely
            .insertInto('case_cohort_links')
            .values({ case_id: caseId, cohort_id: cohortId })
        )
      }
    })
  }

  getCaseHpoTerms(caseId: number): CaseHpoTerm[] {
    return this.execAll<CaseHpoTerm>(
      this.kysely
        .selectFrom('case_hpo_terms')
        .selectAll()
        .where('case_id', '=', caseId)
        .orderBy('hpo_id')
    )
  }

  assignCaseHpoTerm(caseId: number, hpoId: string, hpoLabel: string): CaseHpoTerm {
    const now = Date.now()
    return this.execFirst<CaseHpoTerm>(
      this.kysely
        .insertInto('case_hpo_terms')
        .values({ case_id: caseId, hpo_id: hpoId, hpo_label: hpoLabel, created_at: now })
        .onConflict((oc) => oc.columns(['case_id', 'hpo_id']).doUpdateSet({ hpo_label: hpoLabel }))
        .returningAll()
    ) as CaseHpoTerm
  }

  removeCaseHpoTerm(caseId: number, hpoId: string): void {
    this.execRun(
      this.kysely
        .deleteFrom('case_hpo_terms')
        .where('case_id', '=', caseId)
        .where('hpo_id', '=', hpoId)
    )
  }

  // ============================================================
  // Case Comment Operations
  // ============================================================

  listCaseComments(caseId: number): CaseComment[] {
    return this.execAll<CaseComment>(
      this.kysely
        .selectFrom('case_comments')
        .selectAll()
        .where('case_id', '=', caseId)
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
    )
  }

  createCaseComment(caseId: number, category: CommentCategory, content: string): CaseComment {
    const now = Date.now()
    return this.execFirst<CaseComment>(
      this.kysely
        .insertInto('case_comments')
        .values({ case_id: caseId, category, content, created_at: now })
        .returningAll()
    ) as CaseComment
  }

  updateCaseComment(commentId: number, content: string): CaseComment {
    const now = Date.now()
    const result = this.execFirst<CaseComment>(
      this.kysely
        .updateTable('case_comments')
        .set({ content, updated_at: now })
        .where('id', '=', commentId)
        .returningAll()
    )

    if (!result) {
      throw new NotFoundError('CaseComment', commentId)
    }
    return result
  }

  deleteCaseComment(commentId: number): void {
    const result = this.execRun(this.kysely.deleteFrom('case_comments').where('id', '=', commentId))
    if (result.changes === 0) {
      throw new NotFoundError('CaseComment', commentId)
    }
  }

  // ============================================================
  // Metric Definition Operations
  // ============================================================

  listMetricDefinitions(): MetricDefinition[] {
    return this.execAll<MetricDefinition>(
      this.kysely.selectFrom('metric_definitions').selectAll().orderBy('category').orderBy('name')
    )
  }

  createMetricDefinition(
    name: string,
    valueType: 'numeric' | 'text' | 'date',
    unit: string,
    category: string
  ): MetricDefinition {
    const now = Date.now()
    return this.execFirst<MetricDefinition>(
      this.kysely
        .insertInto('metric_definitions')
        .values({
          name,
          value_type: valueType,
          unit,
          category,
          is_predefined: 0,
          created_at: now
        })
        .returningAll()
    ) as MetricDefinition
  }

  // ============================================================
  // Case Metric Operations
  // ============================================================

  listCaseMetrics(caseId: number): CaseMetricWithDefinition[] {
    return this.execAll<CaseMetricWithDefinition>(
      this.kysely
        .selectFrom('case_metrics as cm')
        .innerJoin('metric_definitions as md', 'cm.metric_id', 'md.id')
        .selectAll('cm')
        .select(['md.name', 'md.value_type', 'md.unit'])
        .select('md.category as metric_category')
        .where('cm.case_id', '=', caseId)
        .orderBy('md.category')
        .orderBy('md.name')
    )
  }

  upsertCaseMetric(
    caseId: number,
    metricId: number,
    value: { numeric_value?: number | null; text_value?: string | null; date_value?: string | null }
  ): CaseMetric {
    const now = Date.now()
    return this.execFirst<CaseMetric>(
      this.kysely
        .insertInto('case_metrics')
        .values({
          case_id: caseId,
          metric_id: metricId,
          numeric_value: value.numeric_value ?? null,
          text_value: value.text_value ?? null,
          date_value: value.date_value ?? null,
          created_at: now,
          updated_at: now
        })
        .onConflict((oc) =>
          oc.columns(['case_id', 'metric_id']).doUpdateSet({
            numeric_value: value.numeric_value ?? null,
            text_value: value.text_value ?? null,
            date_value: value.date_value ?? null,
            updated_at: now
          })
        )
        .returningAll()
    ) as CaseMetric
  }

  deleteCaseMetric(caseId: number, metricId: number): void {
    this.execRun(
      this.kysely
        .deleteFrom('case_metrics')
        .where('case_id', '=', caseId)
        .where('metric_id', '=', metricId)
    )
  }

  // ============================================================
  // Case Data Info (import provenance, platform, pre-filtering)
  // ============================================================

  getCaseDataInfo(caseId: number): CaseDataInfo | null {
    const result = this.execFirst<CaseDataInfo>(
      this.kysely.selectFrom('case_data_info').selectAll().where('case_id', '=', caseId)
    )
    return result ?? null
  }

  upsertCaseDataInfo(
    caseId: number,
    updates: CaseDataInfoUpdates & {
      import_file_name?: string | null
      import_file_type?: string | null
    }
  ): CaseDataInfo {
    return this.runTransaction(() => {
      const now = Date.now()

      const existing = this.execFirst<CaseDataInfo>(
        this.kysely.selectFrom('case_data_info').selectAll().where('case_id', '=', caseId)
      )

      if (existing === undefined) {
        return this.execFirst<CaseDataInfo>(
          this.kysely
            .insertInto('case_data_info')
            .values({
              case_id: caseId,
              import_file_name: updates.import_file_name ?? null,
              import_file_type: updates.import_file_type ?? null,
              platform: updates.platform ?? null,
              platform_details: updates.platform_details ?? null,
              af_filter: updates.af_filter ?? null,
              gene_list_filter: updates.gene_list_filter ?? null,
              region_filter: updates.region_filter ?? null,
              quality_filter: updates.quality_filter ?? null,
              data_notes: updates.data_notes ?? null,
              gene_list_id: updates.gene_list_id ?? null,
              region_file_id: updates.region_file_id ?? null,
              created_at: now,
              updated_at: now
            })
            .returningAll()
        ) as CaseDataInfo
      }

      // Build dynamic update object from explicitly provided fields
      const allFields = [
        'import_file_name',
        'import_file_type',
        'platform',
        'platform_details',
        'af_filter',
        'gene_list_filter',
        'region_filter',
        'quality_filter',
        'data_notes',
        'gene_list_id',
        'region_file_id'
      ] as const
      const updateObj: Record<string, string | number | null> = { updated_at: now }
      for (const field of allFields) {
        if (field in updates) {
          updateObj[field] = updates[field] ?? null
        }
      }
      return this.execFirst<CaseDataInfo>(
        this.kysely
          .updateTable('case_data_info')
          .set(updateObj)
          .where('case_id', '=', caseId)
          .returningAll()
      ) as CaseDataInfo
    })
  }

  // ============================================================
  // Case External IDs (user-defined key-value cross-references)
  // ============================================================

  listCaseExternalIds(caseId: number): CaseExternalId[] {
    return this.execAll<CaseExternalId>(
      this.kysely
        .selectFrom('case_external_ids')
        .selectAll()
        .where('case_id', '=', caseId)
        .orderBy('id_type')
    )
  }

  upsertCaseExternalId(caseId: number, idType: string, idValue: string): CaseExternalId {
    const now = Date.now()
    return this.execFirst<CaseExternalId>(
      this.kysely
        .insertInto('case_external_ids')
        .values({ case_id: caseId, id_type: idType, id_value: idValue, created_at: now })
        .onConflict((oc) => oc.columns(['case_id', 'id_type']).doUpdateSet({ id_value: idValue }))
        .returningAll()
    ) as CaseExternalId
  }

  deleteCaseExternalId(caseId: number, idType: string): void {
    this.execRun(
      this.kysely
        .deleteFrom('case_external_ids')
        .where('case_id', '=', caseId)
        .where('id_type', '=', idType)
    )
  }

  /** Get all distinct platform values across all cases */
  getDistinctPlatforms(): string[] {
    const rows = this.execAll<{ platform: string }>(
      this.kysely
        .selectFrom('case_data_info')
        .select('platform')
        .distinct()
        .where('platform', 'is not', null)
        .orderBy('platform')
    )
    return rows.map((r) => r.platform)
  }

  /** Get all distinct external ID types across all cases */
  getDistinctExternalIdTypes(): string[] {
    const rows = this.execAll<{ id_type: string }>(
      this.kysely.selectFrom('case_external_ids').select('id_type').distinct().orderBy('id_type')
    )
    return rows.map((r) => r.id_type)
  }
}
