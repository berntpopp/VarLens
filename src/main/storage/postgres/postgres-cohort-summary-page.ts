/**
 * Materialised cohort summary page read (count + page) for PostgreSQL, with
 * keyset paging for the default `carrier_count DESC` sort.
 *
 * Extracted from PostgresCohortRepository. When the order is the keyset order
 * (see src/shared/sql/cohort-keyset.ts, index `idx_cvs_carrier_keyset`,
 * migration 0020) and the request carries a valid cursor, the page query adds
 * the row-value seek and drops OFFSET; a full page returns `next_cursor`.
 * Every other sort keeps the OFFSET query unchanged.
 */
import type { Pool } from 'pg'

import { COHORT_KEYSET_FIELDS, cohortKeysetPredicate } from '../../../shared/sql/cohort-keyset'
import type {
  CohortPaginatedResult,
  CohortSearchParams,
  CohortVariant
} from '../../../shared/types/cohort'
import { cohortKeysetScope, decodeCohortCursor, encodeCohortCursor } from '../cohort-keyset-cursor'
import { runNamedDynamic } from './named-query'
import {
  buildSummaryCountSql,
  buildSummaryPageSql,
  buildSummaryQueryParts,
  summaryBuildTotalsJoin
} from './postgres-cohort-summary-query'

export interface SummaryPageContext {
  pool: Pool
  schema: string
  /** Schema-qualified `cohort_variant_summary`. */
  table: string
  /** Schema-qualified `cases` view (visible cases only), the frequency denominator. */
  casesTable: string
  toVariant: (row: Record<string, unknown>) => CohortVariant
}

function toCount(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

/** Returns null when the predicate set is not materialisable (live fallback). */
export async function querySummaryPage(
  ctx: SummaryPageContext,
  params: CohortSearchParams,
  totalCases: number
): Promise<CohortPaginatedResult | null> {
  const summary = buildSummaryQueryParts(params, totalCases)
  if (summary.unavailable) return null
  const { whereParts, orderBy, values, keyset, needsBuildTotals } = summary.parts
  const buildTotalsJoin = summaryBuildTotalsJoin(ctx.casesTable)

  let totalCount = 0
  if (params._count_needed !== false) {
    const countResult = await runNamedDynamic<{ total_count?: unknown }>(ctx.pool, {
      baseName: 'cohort:summary_count',
      text: buildSummaryCountSql(ctx.table, whereParts, needsBuildTotals ? buildTotalsJoin : ''),
      values,
      schema: ctx.schema
    })
    totalCount = toCount(countResult.rows[0]?.total_count)
  }

  const scope = keyset ? cohortKeysetScope(params) : ''
  const seek = keyset ? decodeCohortCursor(scope, params.cursor) : null
  const dataValues = [...values]
  const pageWhere = [...whereParts]
  if (seek !== null) {
    const placeholders = COHORT_KEYSET_FIELDS.map((field, index) => {
      dataValues.push(seek[index])
      const cast = field === 'carrier_count' || field === 'pos' ? 'bigint' : 'text'
      return `$${dataValues.length}::${cast}`
    })
    pageWhere.push(cohortKeysetPredicate('cvs', 'postgres', placeholders))
  }
  const limit = params.limit ?? 50
  dataValues.push(limit, seek !== null ? 0 : (params.offset ?? 0))

  const dataResult = await runNamedDynamic<Record<string, unknown>>(ctx.pool, {
    baseName: seek !== null ? 'cohort:summary_page_keyset' : 'cohort:summary_page',
    text: buildSummaryPageSql(
      ctx.table,
      pageWhere,
      orderBy,
      totalCases,
      dataValues.length - 1,
      dataValues.length,
      buildTotalsJoin
    ),
    values: dataValues,
    schema: ctx.schema
  })

  const rows = dataResult.rows
  const last = rows.length > 0 ? rows[rows.length - 1] : undefined
  const nextCursor =
    keyset && rows.length === limit && last !== undefined
      ? encodeCohortCursor(scope, {
          ...last,
          carrier_count: toCount(last.carrier_count),
          pos: toCount(last.pos),
          variant_type: last._keyset_variant_type,
          genome_build: last._keyset_genome_build
        })
      : undefined

  return {
    data: rows.map((row) => ctx.toVariant(row)),
    total_count: totalCount,
    ...(nextCursor !== undefined ? { next_cursor: nextCursor } : {}),
    ...(seek !== null ? { paging: 'keyset' as const } : {})
  }
}
