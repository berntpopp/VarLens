/**
 * Typed column filter structure for per-column filtering.
 * Replaces the old Record<string, string> with operator-aware filters.
 */

/**
 * Operators for column filters.
 *
 * `is_null` / `not_null` test for a missing value and ignore `value` (send
 * `''`); their SQL comes from `shared/filters/column-null-check.ts`.
 */
export type ColumnFilterOperator =
  '=' | '!=' | '<' | '>' | '<=' | '>=' | 'like' | 'in' | 'is_null' | 'not_null'

/** A single typed column filter */
export interface ColumnFilter {
  operator: ColumnFilterOperator
  value: string | number | string[]
  /**
   * Whether to include NULL/empty values.
   *
   * IMPORTANT: the default diverges between base and extension columns:
   * - **Base columns** (e.g. `gnomad_af`, `cadd`) default to `true` —
   *   unannotated variants pass through range filters so they aren't
   *   silently hidden.
   * - **Extension columns** (e.g. `cnv.copy_number`, `sv.support`) default
   *   to `false` — a missing extension row means "variant is not of this
   *   type", so including NULLs would return cross-type noise.
   *
   * See `src/main/database/variant-extension-registry.ts` (the
   * `translateExtensionFilter` helper) for the extension-side semantics
   * and `src/main/database/VariantFilterBuilder.ts` for the base-side
   * semantics.
   */
  includeEmpty?: boolean
}

/** Column filters map: column key -> typed filter */
export type ColumnFiltersParam = Record<string, ColumnFilter>

/** Filter mode auto-detected or overridden from config */
export type ColumnFilterMode = 'numeric' | 'categorical' | 'text-suggest'

/** A column with at most this many distinct values gets them listed in `distinctValues`. */
export const COHORT_DISTINCT_VALUES_LIMIT = 50

/**
 * Cohort-view metadata reports a distinct count above
 * {@link COHORT_DISTINCT_VALUES_LIMIT} as this value ("more than the limit"):
 * the filter UI only compares the count with a threshold at or below the
 * limit, and counting a high-cardinality column exactly costs a full sort of
 * the cohort summary. Both backends report it the same way.
 */
export const COHORT_DISTINCT_COUNT_CAP = COHORT_DISTINCT_VALUES_LIMIT + 1

/** A cohort-view distinct count as both backends report it. */
export function capCohortDistinctCount(count: number): number {
  return Math.min(count, COHORT_DISTINCT_COUNT_CAP)
}

/** Per-column metadata returned by the backend for filter UI auto-detection */
export interface ColumnFilterMeta {
  /** Column key matching SORTABLE_COLUMNS (e.g. 'cadd') */
  key: string
  /** Inferred from SQLite type affinity */
  dataType: 'numeric' | 'text'
  /**
   * Count of unique non-null values in the current case. The cohort view
   * reports counts above COHORT_DISTINCT_VALUES_LIMIT as COHORT_DISTINCT_COUNT_CAP.
   */
  distinctCount: number
  /** Populated only if distinctCount <= threshold */
  distinctValues?: string[]
  /** For numeric columns: minimum value in the current case */
  min?: number
  /** For numeric columns: maximum value in the current case */
  max?: number
}
