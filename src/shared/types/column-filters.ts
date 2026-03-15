/**
 * Typed column filter structure for per-column filtering.
 * Replaces the old Record<string, string> with operator-aware filters.
 */

/** Operators for column filters */
export type ColumnFilterOperator = '=' | '!=' | '<' | '>' | '<=' | '>=' | 'like' | 'in'

/** A single typed column filter */
export interface ColumnFilter {
  operator: ColumnFilterOperator
  value: string | number | string[]
  /** Whether to include NULL/empty values (default: true for range operators) */
  includeEmpty?: boolean
}

/** Column filters map: column key -> typed filter */
export type ColumnFiltersParam = Record<string, ColumnFilter>

/** Filter mode auto-detected or overridden from config */
export type ColumnFilterMode = 'numeric' | 'categorical' | 'text-suggest'

/** Per-column metadata returned by the backend for filter UI auto-detection */
export interface ColumnFilterMeta {
  /** Column key matching SORTABLE_COLUMNS (e.g. 'cadd') */
  key: string
  /** Inferred from SQLite type affinity */
  dataType: 'numeric' | 'text'
  /** Count of unique non-null values in the current case */
  distinctCount: number
  /** Populated only if distinctCount <= threshold */
  distinctValues?: string[]
  /** For numeric columns: minimum value in the current case */
  min?: number
  /** For numeric columns: maximum value in the current case */
  max?: number
}
