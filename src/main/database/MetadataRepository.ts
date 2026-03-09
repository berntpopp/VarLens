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

      // Build dynamic SET clause: only update fields explicitly provided (even if null)
      const setClauses: string[] = ['updated_at = ?']
      const setParams: (string | number | null)[] = [now]

      const fields = ['affected_status', 'sex', 'notes', 'age', 'date_of_birth'] as const
      for (const field of fields) {
        if (field in updates) {
          setClauses.push(`${field} = ?`)
          setParams.push(updates[field] ?? null)
        }
      }

      // Try INSERT first, then UPDATE on conflict
      const existing = this.execFirst<CaseMetadata>(
        this.kysely.selectFrom('case_metadata').selectAll().where('case_id', '=', caseId)
      )

      if (existing === undefined) {
        return this.stmt(
          `INSERT INTO case_metadata (case_id, affected_status, sex, notes, age, date_of_birth, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
        ).get(
          caseId,
          updates.affected_status ?? null,
          updates.sex ?? null,
          updates.notes ?? null,
          updates.age ?? null,
          updates.date_of_birth ?? null,
          now,
          now
        ) as CaseMetadata
      }

      setParams.push(caseId)
      const sql = `UPDATE case_metadata SET ${setClauses.join(', ')} WHERE case_id = ? RETURNING *`
      return this.db.prepare(sql).get(...setParams) as CaseMetadata
    })
  }

  listCohortGroups(): CohortGroup[] {
    return this.execAll<CohortGroup>(
      this.kysely.selectFrom('cohort_groups').selectAll().orderBy('name')
    )
  }

  createCohortGroup(name: string, description?: string | null): CohortGroup {
    const now = Date.now()
    const result = this.stmt(
      'INSERT INTO cohort_groups (name, description, created_at) VALUES (?, ?, ?) RETURNING *'
    ).get(name, description ?? null, now) as CohortGroup
    return result
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

      const setClauses: string[] = []
      const params: (string | number | null)[] = []

      if (updates.name !== undefined) {
        setClauses.push('name = ?')
        params.push(updates.name)
      }
      if (updates.description !== undefined) {
        setClauses.push('description = ?')
        params.push(updates.description)
      }

      if (setClauses.length === 0) return existing

      params.push(id)
      const sql = `UPDATE cohort_groups SET ${setClauses.join(', ')} WHERE id = ? RETURNING *`
      const result = this.db.prepare(sql).get(...params) as CohortGroup
      return result
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
    return this.stmt(
      `
      SELECT cg.* FROM cohort_groups cg
      JOIN case_cohort_links ccl ON cg.id = ccl.cohort_id
      WHERE ccl.case_id = ?
      ORDER BY cg.name
    `
    ).all(caseId) as CohortGroup[]
  }

  assignCaseCohort(caseId: number, cohortId: number): void {
    this.stmt(
      'INSERT INTO case_cohort_links (case_id, cohort_id) VALUES (?, ?) ON CONFLICT DO NOTHING'
    ).run(caseId, cohortId)
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
      this.stmt('DELETE FROM case_cohort_links WHERE case_id = ?').run(caseId)
      const insert = this.stmt('INSERT INTO case_cohort_links (case_id, cohort_id) VALUES (?, ?)')
      for (const cohortId of cohortIds) {
        insert.run(caseId, cohortId)
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
    const result = this.stmt(
      `
      INSERT INTO case_hpo_terms (case_id, hpo_id, hpo_label, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(case_id, hpo_id) DO UPDATE SET hpo_label = excluded.hpo_label
      RETURNING *
    `
    ).get(caseId, hpoId, hpoLabel, now) as CaseHpoTerm
    return result
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
    return this.stmt(
      'INSERT INTO case_comments (case_id, category, content, created_at) VALUES (?, ?, ?, ?) RETURNING *'
    ).get(caseId, category, content, now) as CaseComment
  }

  updateCaseComment(commentId: number, content: string): CaseComment {
    const now = Date.now()
    const result = this.stmt(
      'UPDATE case_comments SET content = ?, updated_at = ? WHERE id = ? RETURNING *'
    ).get(content, now, commentId) as CaseComment | undefined

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
    return this.stmt(
      'INSERT INTO metric_definitions (name, value_type, unit, category, is_predefined, created_at) VALUES (?, ?, ?, ?, 0, ?) RETURNING *'
    ).get(name, valueType, unit, category, now) as MetricDefinition
  }

  // ============================================================
  // Case Metric Operations
  // ============================================================

  listCaseMetrics(caseId: number): CaseMetricWithDefinition[] {
    return this.stmt(
      `
      SELECT cm.*, md.name, md.value_type, md.unit, md.category AS metric_category
      FROM case_metrics cm
      JOIN metric_definitions md ON cm.metric_id = md.id
      WHERE cm.case_id = ?
      ORDER BY md.category, md.name
    `
    ).all(caseId) as CaseMetricWithDefinition[]
  }

  upsertCaseMetric(
    caseId: number,
    metricId: number,
    value: { numeric_value?: number | null; text_value?: string | null; date_value?: string | null }
  ): CaseMetric {
    const now = Date.now()
    return this.stmt(
      `
      INSERT INTO case_metrics (case_id, metric_id, numeric_value, text_value, date_value, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(case_id, metric_id) DO UPDATE SET
        numeric_value = excluded.numeric_value,
        text_value = excluded.text_value,
        date_value = excluded.date_value,
        updated_at = excluded.updated_at
      RETURNING *
    `
    ).get(
      caseId,
      metricId,
      value.numeric_value ?? null,
      value.text_value ?? null,
      value.date_value ?? null,
      now,
      now
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
        return this.stmt(
          `INSERT INTO case_data_info (case_id, import_file_name, import_file_type, platform, platform_details, af_filter, gene_list_filter, region_filter, quality_filter, data_notes, gene_list_id, region_file_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
        ).get(
          caseId,
          updates.import_file_name ?? null,
          updates.import_file_type ?? null,
          updates.platform ?? null,
          updates.platform_details ?? null,
          updates.af_filter ?? null,
          updates.gene_list_filter ?? null,
          updates.region_filter ?? null,
          updates.quality_filter ?? null,
          updates.data_notes ?? null,
          updates.gene_list_id ?? null,
          updates.region_file_id ?? null,
          now,
          now
        ) as CaseDataInfo
      }

      // Build dynamic SET clause: only update fields explicitly provided (even if null)
      const setClauses: string[] = ['updated_at = ?']
      const setParams: (string | number | null)[] = [now]

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
      for (const field of allFields) {
        if (field in updates) {
          setClauses.push(`${field} = ?`)
          setParams.push(updates[field] ?? null)
        }
      }

      setParams.push(caseId)
      const sql = `UPDATE case_data_info SET ${setClauses.join(', ')} WHERE case_id = ? RETURNING *`
      return this.db.prepare(sql).get(...setParams) as CaseDataInfo
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
    return this.stmt(
      `INSERT INTO case_external_ids (case_id, id_type, id_value, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(case_id, id_type) DO UPDATE SET id_value = excluded.id_value
       RETURNING *`
    ).get(caseId, idType, idValue, now) as CaseExternalId
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
