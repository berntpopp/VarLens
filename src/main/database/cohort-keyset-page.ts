/**
 * SQLite side of cohort keyset paging (see src/shared/sql/cohort-keyset.ts).
 *
 * For the default sort (`carrier_count DESC`) the page query orders by the
 * keyset terms served by `idx_cvs_carrier_keyset` (migration v37) and, when
 * the request carries a valid cursor, seeks past the previous page's last row
 * instead of scanning OFFSET rows. Every other sort returns null here and the
 * caller keeps its OFFSET query unchanged.
 */
import {
  COHORT_KEYSET_FIELDS,
  cohortKeysetOrderByClause,
  cohortKeysetPredicate,
  isCohortKeysetSort
} from '../../shared/sql/cohort-keyset'
import type { CohortPaginatedResult, CohortSearchParams } from '../../shared/types/cohort'
import {
  cohortKeysetScope,
  decodeCohortCursor,
  encodeCohortCursor
} from '../storage/cohort-keyset-cursor'

/** Extra columns selected for the cursor and stripped before returning rows. */
export const SQLITE_KEYSET_EXTRA_COLUMNS =
  'cvs.variant_type AS _keyset_variant_type, cvs.genome_build AS _keyset_genome_build'

export interface SqliteCohortKeysetPlan {
  orderBy: string
  /** Extra condition to AND into the WHERE clause ('' when not seeking). */
  seekCondition: string
  /** Named bindings (`@keyset_N`) for `seekCondition`; pass as one extra argument. */
  seekBindings: Record<string, unknown>
  /** True when the cursor was honoured (OFFSET must then be 0). */
  seeking: boolean
  finalize(rows: Array<Record<string, unknown>>, limit: number): Partial<CohortPaginatedResult>
}

/**
 * The seek uses named parameters (`@keyset_0` …) because the chromosome value
 * occurs several times in the rank expression; better-sqlite3 binds them from
 * an object passed next to the anonymous `?` values.
 */
export function planSqliteCohortKeyset(
  params: CohortSearchParams,
  sortKey: string,
  direction: 'asc' | 'desc'
): SqliteCohortKeysetPlan | null {
  if (!isCohortKeysetSort(sortKey, direction)) return null
  const scope = cohortKeysetScope(params)
  const seek = decodeCohortCursor(scope, params.cursor)
  const placeholders = COHORT_KEYSET_FIELDS.map((_, i) => `@keyset_${i}`)
  const seekBindings: Record<string, unknown> = {}
  seek?.forEach((value, i) => {
    seekBindings[`keyset_${i}`] = value
  })

  return {
    orderBy: cohortKeysetOrderByClause('cvs', 'sqlite'),
    seekCondition: seek !== null ? cohortKeysetPredicate('cvs', 'sqlite', placeholders) : '',
    seekBindings,
    seeking: seek !== null,
    finalize(rows, limit) {
      let nextCursor: string | undefined
      const last = rows.length > 0 ? rows[rows.length - 1] : undefined
      if (rows.length === limit && last !== undefined) {
        nextCursor = encodeCohortCursor(scope, {
          ...last,
          variant_type: last._keyset_variant_type,
          genome_build: last._keyset_genome_build
        })
      }
      for (const row of rows) {
        delete row._keyset_variant_type
        delete row._keyset_genome_build
      }
      return {
        ...(nextCursor !== undefined ? { next_cursor: nextCursor } : {}),
        ...(seek !== null ? { paging: 'keyset' as const } : {})
      }
    }
  }
}
