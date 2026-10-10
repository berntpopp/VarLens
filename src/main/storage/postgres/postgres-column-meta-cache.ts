import { offeredFilterValues } from '../../../shared/config/severity.config'
import type { FilterOptions } from '../../../shared/types/api'
import type { ColumnFilterMeta } from '../../../shared/types/column-filters'
import { toNumber } from './identifiers'

/**
 * Sprint A PR-3 C4 — read-side helpers for the per-case `cohort_column_meta`
 * cache (populated by C2's refreshColumnMetas on import + delete + rebuild).
 *
 * The cache mirrors SQLite getAllColumnMetas: one row per filterable base
 * column, with distinct_count for every column, MIN/MAX (JSONB numbers) for
 * numerics, and the sorted distinct_values array (JSONB) for low-cardinality
 * columns. These helpers reshape those rows into the renderer-facing
 * ColumnFilterMeta / FilterOptions contract so getFilterOptions(caseId) and the
 * single-case getColumnMeta branch match the SQLite output shape.
 */

/**
 * Filterable base columns mirrored from PostgresCohortSummaryRepository's
 * META_COLUMNS (the source of truth for which columns refreshColumnMetas
 * materialises into cohort_column_meta). Order matches SQLite getAllColumnMetas
 * so the reshaped FilterOptions.columnMeta order is stable. `cadd` (not
 * `cadd_phred`) — Postgres uses the physical column name.
 */
export const PER_CASE_META_COLUMNS = [
  'chr',
  'pos',
  'gene_symbol',
  'omim_mim_number',
  'func',
  'consequence',
  'transcript',
  'cdna',
  'aa_change',
  'gt_num',
  'gnomad_af',
  'cadd',
  'qual',
  'hpo_sim_score',
  'clinvar',
  'moi',
  'variant_type',
  'end_pos',
  'sv_type',
  'sv_length',
  'caller'
] as const

/**
 * Numeric columns that surface min/max in the reshaped per-case meta. This set
 * MUST match the write side exactly: PostgresCohortSummaryRepository's
 * META_NUMERIC_COLUMNS (which is what refreshColumnMetas actually populates
 * min_value/max_value for) and the SQLite parity source-of-truth
 * NUMERIC_COLUMNS in src/main/database/VariantRepository.ts. `end_pos` and
 * `sv_length` are categorical on the write side (no min/max materialised), so
 * they must report dataType 'text' here to match SQLite output-shape parity.
 */
export const PER_CASE_NUMERIC_COLUMNS = new Set<string>([
  'pos',
  'gnomad_af',
  'cadd',
  'qual',
  'hpo_sim_score'
])

/** Row shape from cohort_column_meta. JSONB columns are parsed by node-pg. */
export interface ColumnMetaRow {
  column_name: string
  min_value: number | null
  max_value: number | null
  distinct_count: number | string | null
  distinct_values: string[] | null
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined
  const numberValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numberValue) ? numberValue : undefined
}

/**
 * Convert a single cohort_column_meta row into a ColumnFilterMeta entry.
 * Numeric columns surface min/max; low-cardinality columns surface the stored
 * distinct_values array (already sorted by refreshColumnMetas).
 */
export function columnMetaRowToFilterMeta(
  key: string,
  isNumeric: boolean,
  row: ColumnMetaRow
): ColumnFilterMeta {
  const entry: ColumnFilterMeta = {
    key,
    dataType: isNumeric ? 'numeric' : 'text',
    distinctCount: toNumber(row.distinct_count)
  }
  if (isNumeric) {
    const min = toOptionalNumber(row.min_value)
    const max = toOptionalNumber(row.max_value)
    if (min !== undefined) entry.min = min
    if (max !== undefined) entry.max = max
  }
  if (Array.isArray(row.distinct_values)) {
    entry.distinctValues = offeredFilterValues(
      entry.key,
      row.distinct_values.map((value) => String(value))
    )
  }
  return entry
}

/** Empty-distinct entry for a column with no stored row. */
export function emptyColumnMeta(key: string, isNumeric: boolean): ColumnFilterMeta {
  return { key, dataType: isNumeric ? 'numeric' : 'text', distinctCount: 0 }
}

/**
 * Reshape cohort_column_meta rows into the SQLite-compatible FilterOptions
 * output. The columnMeta list is ordered by PER_CASE_META_COLUMNS so the shape
 * matches SQLite getFilterOptions; columns with no stored row degrade to an
 * empty-distinct entry rather than vanishing.
 */
export function reshapeFilterOptions(rows: ColumnMetaRow[]): FilterOptions {
  const rowByName = new Map(rows.map((row) => [row.column_name, row]))
  const columnMeta: ColumnFilterMeta[] = PER_CASE_META_COLUMNS.map((key) => {
    const isNumeric = PER_CASE_NUMERIC_COLUMNS.has(key)
    const row = rowByName.get(key)
    return row === undefined
      ? emptyColumnMeta(key, isNumeric)
      : columnMetaRowToFilterMeta(key, isNumeric, row)
  })

  const metaByKey = new Map(columnMeta.map((meta) => [meta.key, meta]))
  const caddMeta = metaByKey.get('cadd')
  const gnomadAfMeta = metaByKey.get('gnomad_af')

  return {
    consequences: metaByKey.get('consequence')?.distinctValues ?? [],
    funcs: metaByKey.get('func')?.distinctValues ?? [],
    clinvars: metaByKey.get('clinvar')?.distinctValues ?? [],
    minCadd: caddMeta?.min ?? null,
    maxCadd: caddMeta?.max ?? null,
    minGnomadAf: gnomadAfMeta?.min ?? null,
    maxGnomadAf: gnomadAfMeta?.max ?? null,
    columnMeta
  }
}
