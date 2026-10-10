import type { Pool, QueryResult } from 'pg'

import type {
  CohortUpdateParams,
  DataInfoUpdates,
  FullCaseMetadataResult,
  MetadataUpdates
} from '../case-metadata-types'
import { quoteIdentifier } from './identifiers'
import { withTransaction } from './transaction'

type Queryable = Pick<Pool, 'query' | 'connect'>
type Row = Record<string, unknown>

const integerFields = new Set([
  'id',
  'case_id',
  'cohort_id',
  'metric_id',
  'case_count',
  'created_at',
  'updated_at',
  'gene_list_id',
  'region_file_id'
])

function normalizeRow<T extends Row>(row: T): Row {
  const normalized: Row = { ...row }
  for (const field of integerFields) {
    const value = normalized[field]
    if (typeof value === 'string') {
      normalized[field] = Number(value)
    }
  }
  return normalized
}

function firstNormalized(result: QueryResult<Row>): Row | null {
  const row = result.rows[0]
  return row === undefined ? null : normalizeRow(row)
}

function allNormalized(result: QueryResult<Row>): Row[] {
  return result.rows.map((row) => normalizeRow(row))
}

export class PostgresCaseMetadataRepository {
  constructor(
    private readonly pool: Queryable,
    private readonly schema: string
  ) {}

  async getCaseMetadata(caseId: number): Promise<unknown | null> {
    const result = await this.pool.query<Row>(
      `SELECT * FROM ${this.table('case_metadata')} WHERE case_id = $1`,
      [caseId]
    )
    return firstNormalized(result)
  }

  async upsertCaseMetadata(caseId: number, updates: MetadataUpdates): Promise<unknown> {
    const now = Date.now()
    const result = await this.pool.query<Row>(
      `
        INSERT INTO ${this.table('case_metadata')} (
          case_id,
          affected_status,
          sex,
          notes,
          age,
          date_of_birth,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
        ON CONFLICT (case_id) DO UPDATE SET
          affected_status = CASE WHEN $8 THEN EXCLUDED.affected_status ELSE case_metadata.affected_status END,
          sex = CASE WHEN $9 THEN EXCLUDED.sex ELSE case_metadata.sex END,
          notes = CASE WHEN $10 THEN EXCLUDED.notes ELSE case_metadata.notes END,
          age = CASE WHEN $11 THEN EXCLUDED.age ELSE case_metadata.age END,
          date_of_birth = CASE WHEN $12 THEN EXCLUDED.date_of_birth ELSE case_metadata.date_of_birth END,
          updated_at = EXCLUDED.updated_at
        RETURNING *
      `,
      [
        caseId,
        updates.affected_status ?? null,
        updates.sex ?? null,
        updates.notes ?? null,
        updates.age ?? null,
        updates.date_of_birth ?? null,
        now,
        'affected_status' in updates,
        'sex' in updates,
        'notes' in updates,
        'age' in updates,
        'date_of_birth' in updates
      ]
    )
    return firstNormalized(result)
  }

  async listCohortGroups(): Promise<unknown[]> {
    const result = await this.pool.query<Row>(
      `SELECT * FROM ${this.table('cohort_groups')} ORDER BY name`,
      []
    )
    return allNormalized(result)
  }

  async createCohortGroup(name: string, description?: string | null): Promise<unknown> {
    const result = await this.pool.query<Row>(
      `
        INSERT INTO ${this.table('cohort_groups')} (name, description, created_at)
        VALUES ($1, $2, $3)
        RETURNING *
      `,
      [name, description ?? null, Date.now()]
    )
    return firstNormalized(result)
  }

  async updateCohortGroup(cohortId: number, updates: CohortUpdateParams): Promise<unknown> {
    const existing = await this.pool.query<Row>(
      `SELECT * FROM ${this.table('cohort_groups')} WHERE id = $1`,
      [cohortId]
    )
    if (existing.rows[0] === undefined) {
      return null
    }

    const result = await this.pool.query<Row>(
      `
        UPDATE ${this.table('cohort_groups')}
        SET
          name = CASE WHEN $2 THEN $3 ELSE name END,
          description = CASE WHEN $4 THEN $5 ELSE description END
        WHERE id = $1
        RETURNING *
      `,
      [
        cohortId,
        'name' in updates,
        updates.name ?? null,
        'description' in updates,
        updates.description ?? null
      ]
    )
    return firstNormalized(result)
  }

  async deleteCohortGroup(cohortId: number): Promise<void> {
    await this.pool.query(`DELETE FROM ${this.table('cohort_groups')} WHERE id = $1`, [cohortId])
  }

  async getCohortGroupByName(name: string): Promise<unknown | null> {
    const result = await this.pool.query<Row>(
      `SELECT * FROM ${this.table('cohort_groups')} WHERE name = $1`,
      [name]
    )
    return firstNormalized(result)
  }

  async getCaseCohorts(caseId: number): Promise<unknown[]> {
    const result = await this.pool.query<Row>(
      `
        SELECT cg.*
        FROM ${this.table('cohort_groups')} cg
        INNER JOIN ${this.table('case_cohort_links')} ccl ON ccl.cohort_id = cg.id
        WHERE ccl.case_id = $1
        ORDER BY cg.name
      `,
      [caseId]
    )
    return allNormalized(result)
  }

  async assignCaseCohort(caseId: number, cohortId: number): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO ${this.table('case_cohort_links')} (case_id, cohort_id)
        VALUES ($1, $2)
        ON CONFLICT (case_id, cohort_id) DO NOTHING
      `,
      [caseId, cohortId]
    )
  }

  async removeCaseCohort(caseId: number, cohortId: number): Promise<void> {
    await this.pool.query(
      `DELETE FROM ${this.table('case_cohort_links')} WHERE case_id = $1 AND cohort_id = $2`,
      [caseId, cohortId]
    )
  }

  async setCaseCohorts(caseId: number, cohortIds: number[]): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await client.query(`DELETE FROM ${this.table('case_cohort_links')} WHERE case_id = $1`, [
        caseId
      ])
      await client.query(
        `
          INSERT INTO ${this.table('case_cohort_links')} (case_id, cohort_id)
          SELECT $1, cohort_id
          FROM UNNEST($2::bigint[]) AS cohort_id
          ON CONFLICT (case_id, cohort_id) DO NOTHING
        `,
        [caseId, cohortIds]
      )
    })
  }

  async getCaseHpoTerms(caseId: number): Promise<unknown[]> {
    const result = await this.pool.query<Row>(
      `SELECT * FROM ${this.table('case_hpo_terms')} WHERE case_id = $1 ORDER BY hpo_id`,
      [caseId]
    )
    return allNormalized(result)
  }

  async assignCaseHpoTerm(caseId: number, hpoId: string, hpoLabel: string): Promise<unknown> {
    const result = await this.pool.query<Row>(
      `
        INSERT INTO ${this.table('case_hpo_terms')} (case_id, hpo_id, hpo_label, created_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (case_id, hpo_id) DO UPDATE SET hpo_label = EXCLUDED.hpo_label
        RETURNING *
      `,
      [caseId, hpoId, hpoLabel, Date.now()]
    )
    return firstNormalized(result)
  }

  async removeCaseHpoTerm(caseId: number, hpoId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM ${this.table('case_hpo_terms')} WHERE case_id = $1 AND hpo_id = $2`,
      [caseId, hpoId]
    )
  }

  async getCaseDataInfo(caseId: number): Promise<unknown | null> {
    const result = await this.pool.query<Row>(
      `SELECT * FROM ${this.table('case_data_info')} WHERE case_id = $1`,
      [caseId]
    )
    return firstNormalized(result)
  }

  async upsertCaseDataInfo(caseId: number, updates: DataInfoUpdates): Promise<unknown> {
    const now = Date.now()
    const result = await this.pool.query<Row>(
      `
        INSERT INTO ${this.table('case_data_info')} (
          case_id,
          platform,
          platform_details,
          af_filter,
          gene_list_filter,
          region_filter,
          quality_filter,
          data_notes,
          gene_list_id,
          region_file_id,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
        ON CONFLICT (case_id) DO UPDATE SET
          platform = CASE WHEN $12 THEN EXCLUDED.platform ELSE case_data_info.platform END,
          platform_details = CASE WHEN $13 THEN EXCLUDED.platform_details ELSE case_data_info.platform_details END,
          af_filter = CASE WHEN $14 THEN EXCLUDED.af_filter ELSE case_data_info.af_filter END,
          gene_list_filter = CASE WHEN $15 THEN EXCLUDED.gene_list_filter ELSE case_data_info.gene_list_filter END,
          region_filter = CASE WHEN $16 THEN EXCLUDED.region_filter ELSE case_data_info.region_filter END,
          quality_filter = CASE WHEN $17 THEN EXCLUDED.quality_filter ELSE case_data_info.quality_filter END,
          data_notes = CASE WHEN $18 THEN EXCLUDED.data_notes ELSE case_data_info.data_notes END,
          gene_list_id = CASE WHEN $19 THEN EXCLUDED.gene_list_id ELSE case_data_info.gene_list_id END,
          region_file_id = CASE WHEN $20 THEN EXCLUDED.region_file_id ELSE case_data_info.region_file_id END,
          updated_at = EXCLUDED.updated_at
        RETURNING *
      `,
      [
        caseId,
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
        'platform' in updates,
        'platform_details' in updates,
        'af_filter' in updates,
        'gene_list_filter' in updates,
        'region_filter' in updates,
        'quality_filter' in updates,
        'data_notes' in updates,
        'gene_list_id' in updates,
        'region_file_id' in updates
      ]
    )
    return firstNormalized(result)
  }

  async listCaseExternalIds(caseId: number): Promise<unknown[]> {
    const result = await this.pool.query<Row>(
      `SELECT * FROM ${this.table('case_external_ids')} WHERE case_id = $1 ORDER BY id_type`,
      [caseId]
    )
    return allNormalized(result)
  }

  async upsertCaseExternalId(caseId: number, idType: string, idValue: string): Promise<unknown> {
    const result = await this.pool.query<Row>(
      `
        INSERT INTO ${this.table('case_external_ids')} (case_id, id_type, id_value, created_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (case_id, id_type) DO UPDATE SET id_value = EXCLUDED.id_value
        RETURNING *
      `,
      [caseId, idType, idValue, Date.now()]
    )
    return firstNormalized(result)
  }

  async deleteCaseExternalId(caseId: number, idType: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM ${this.table('case_external_ids')} WHERE case_id = $1 AND id_type = $2`,
      [caseId, idType]
    )
  }

  async listCaseComments(caseId: number): Promise<unknown[]> {
    const result = await this.pool.query<Row>(
      `
        SELECT *
        FROM ${this.table('case_comments')}
        WHERE case_id = $1
        ORDER BY created_at DESC, id DESC
      `,
      [caseId]
    )
    return allNormalized(result)
  }

  async listCaseMetrics(caseId: number): Promise<unknown[]> {
    const result = await this.pool.query<Row>(
      `
        SELECT
          cm.*,
          md.name,
          md.value_type,
          md.unit,
          md.category AS metric_category
        FROM ${this.table('case_metrics')} cm
        INNER JOIN ${this.table('metric_definitions')} md ON md.id = cm.metric_id
        WHERE cm.case_id = $1
        ORDER BY md.category, md.name
      `,
      [caseId]
    )
    return allNormalized(result)
  }

  async getDistinctHpoTerms(): Promise<unknown[]> {
    const result = await this.pool.query<Row>(
      `
        SELECT hpo_id, MIN(hpo_label) AS hpo_label
        FROM ${this.table('case_hpo_terms')}
        GROUP BY hpo_id
        ORDER BY hpo_label
      `,
      []
    )
    return allNormalized(result)
  }

  async getDistinctPlatforms(): Promise<string[]> {
    const result = await this.pool.query<{ platform: string }>(
      `
        SELECT DISTINCT platform
        FROM ${this.table('case_data_info')}
        WHERE platform IS NOT NULL
        ORDER BY platform
      `,
      []
    )
    return result.rows.map((row) => row.platform)
  }

  async getDistinctExternalIdTypes(): Promise<string[]> {
    const result = await this.pool.query<{ id_type: string }>(
      `
        SELECT DISTINCT id_type
        FROM ${this.table('case_external_ids')}
        ORDER BY id_type
      `,
      []
    )
    return result.rows.map((row) => row.id_type)
  }

  async getFullCaseMetadata(caseId: number): Promise<FullCaseMetadataResult> {
    const [metadata, cohorts, hpoTerms, comments, metrics, dataInfo, externalIds] =
      await Promise.all([
        this.getCaseMetadata(caseId),
        this.getCaseCohorts(caseId),
        this.getCaseHpoTerms(caseId),
        this.listCaseComments(caseId),
        this.listCaseMetrics(caseId),
        this.getCaseDataInfo(caseId),
        this.listCaseExternalIds(caseId)
      ])

    return {
      metadata,
      cohorts,
      hpoTerms,
      comments,
      metrics,
      dataInfo,
      externalIds
    }
  }

  private table(name: string): string {
    return `${quoteIdentifier(this.schema)}.${quoteIdentifier(name)}`
  }
}
