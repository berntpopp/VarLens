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
