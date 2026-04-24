import type { Pool } from 'pg'

import type { CaseWithCohorts, PaginatedResult } from '../../../shared/types/database'
import type { ValidatedCaseSearchParams } from '../../../shared/types/ipc-schemas'
import { quoteIdentifier } from './identifiers'

export class PostgresCasesQueryRepository {
  constructor(
    private readonly pool: Pool,
    private readonly schema: string
  ) {}

  async queryCases(params: ValidatedCaseSearchParams): Promise<PaginatedResult<CaseWithCohorts>> {
    const limit = params.limit
    const offset = params.offset ?? 0
    const searchTerm = params.search_term?.trim()
    const sortBy = params.sort_by ?? 'created_at'
    const sortOrder = params.sort_order ?? 'desc'

    if ((params.cohort_ids?.length ?? 0) > 0) {
      throw new Error(
        'cases:query cohort_ids filtering is not implemented for postgres sessions in Phase 4'
      )
    }

    if ((params.hpo_ids?.length ?? 0) > 0) {
      throw new Error(
        'cases:query hpo_ids filtering is not implemented for postgres sessions in Phase 4'
      )
    }

    const values: unknown[] = []
    const whereClauses: string[] = []

    if (searchTerm !== undefined && searchTerm !== '') {
      values.push(`%${searchTerm}%`)
      whereClauses.push(`c.name ILIKE $${values.length}`)
    }

    const orderColumn =
      sortBy === 'name' ? 'c.name' : sortBy === 'variant_count' ? 'c.variant_count' : 'c.created_at'
    const orderDirection = sortOrder === 'asc' ? 'ASC' : 'DESC'
    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''
    const schemaName = quoteIdentifier(this.schema)

    const rowsSql = `
      SELECT
        c.id,
        c.name,
        c.file_path,
        c.file_size,
        c.variant_count,
        c.created_at,
        c.genome_build,
        cm.affected_status,
        cm.sex,
        COALESCE(array_agg(DISTINCT cg.name) FILTER (WHERE cg.name IS NOT NULL), '{}'::text[]) AS cohort_names,
        COALESCE(array_agg(DISTINCT cg.id) FILTER (WHERE cg.id IS NOT NULL), '{}'::int[]) AS cohort_ids
      FROM ${schemaName}."cases" c
      LEFT JOIN ${schemaName}."case_metadata" cm ON cm.case_id = c.id
      LEFT JOIN ${schemaName}."case_cohort_links" ccl ON ccl.case_id = c.id
      LEFT JOIN ${schemaName}."cohort_groups" cg ON cg.id = ccl.cohort_id
      ${whereSql}
      GROUP BY c.id, cm.affected_status, cm.sex
      ORDER BY ${orderColumn} ${orderDirection}
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}
    `

    const countSql = `
      SELECT COUNT(*)::int AS total_count
      FROM ${schemaName}."cases" c
      ${whereSql}
    `

    const rowsResult = await this.pool.query(rowsSql, [...values, limit, offset])
    const countResult = await this.pool.query(countSql, values)

    return {
      data: rowsResult.rows.map((row) => ({
        id: Number(row.id),
        name: String(row.name),
        file_path: String(row.file_path),
        file_size: Number(row.file_size),
        variant_count: Number(row.variant_count),
        created_at: Number(row.created_at),
        genome_build: String(row.genome_build),
        affected_status: row.affected_status ?? null,
        sex: row.sex ?? null,
        cohort_names: Array.isArray(row.cohort_names) ? row.cohort_names.map(String) : [],
        cohort_ids: Array.isArray(row.cohort_ids) ? row.cohort_ids.map(Number) : []
      })),
      total_count: Number(countResult.rows[0]?.total_count ?? 0)
    }
  }
}
