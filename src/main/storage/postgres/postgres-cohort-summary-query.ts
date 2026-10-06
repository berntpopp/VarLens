import type { ColumnFilter } from '../../../shared/types/column-filters'
import type { CohortSearchParams } from '../../../shared/types/cohort'
import { POSTGRES_VARIANT_COLUMN_DEFINITIONS } from './postgres-variant-columns'
import { cohortOrderByClause } from '../../../shared/sql/chromosome-order'
import { cohortKeysetOrderByClause, isCohortKeysetSort } from '../../../shared/sql/cohort-keyset'

/**
 * Summary read-side query builder (Sprint A PR-3 C4).
 *
 * Mirrors `PostgresCohortRepository.buildQueryParts`, but maps every predicate
 * to alias `cvs` for the materialised `cohort_variant_summary` table. Because
 * carrier_count / het_count / hom_count / cohort_frequency are stored columns
 * on `cohort_variant_summary`, the predicates that the live builder pushes into
 * `HAVING` (over a `GROUP BY`) become plain `WHERE` predicates here — there is
 * no grouping in the summary path.
 *
 * Extension-table predicates (any `variant_extensions` column, keyed `sv.*`,
 * `cnv.*`, `str.*`) are not materialised into the summary in Sprint A, so the
 * builder returns `{ unavailable: true }` and the caller falls back to the live
 * `buildQueryParts` path.
 */

export interface SummaryQueryParts {
  joins: string
  whereParts: string[]
  orderBy: string
  values: unknown[]
  /** True when `orderBy` is the keyset order (default carrier-count sort). */
  keyset: boolean
}

/** `WHERE ...` clause (or empty string) for a summary-page query. */
function summaryWhereClause(whereParts: string[]): string {
  return whereParts.length > 0 ? `WHERE ${whereParts.join('\n         AND ')}` : ''
}

/** COUNT(*) SQL for the materialised cohort_variant_summary page. */
export function buildSummaryCountSql(qualifiedTable: string, whereParts: string[]): string {
  return `SELECT COUNT(*)::bigint AS total_count
      FROM ${qualifiedTable} cvs
      ${summaryWhereClause(whereParts)}`
}

/**
 * Page SQL for the materialised cohort_variant_summary read. Aliases the stored
 * `cadd` / `omim_mim_number` columns to the CohortVariant field names
 * (`cadd_phred`, `omim_id`) so toCohortVariant maps them unchanged. `totalCases`
 * is interpolated (it is a number, never user input) to surface total_cases per
 * row the same way the live path does.
 */
export function buildSummaryPageSql(
  qualifiedTable: string,
  whereParts: string[],
  orderBy: string,
  totalCases: number,
  limitParamIndex: number,
  offsetParamIndex: number
): string {
  return `SELECT
      cvs.chr,
      cvs.pos,
      cvs.ref,
      cvs.alt,
      cvs.gene_symbol,
      cvs.cdna,
      cvs.aa_change,
      cvs.carrier_count,
      ${totalCases}::bigint AS total_cases,
      cvs.cohort_frequency,
      cvs.het_count,
      cvs.hom_count,
      cvs.variant_key,
      cvs.consequence,
      cvs.func,
      cvs.clinvar,
      cvs.gnomad_af,
      cvs.cadd AS cadd_phred,
      cvs.transcript,
      cvs.omim_mim_number AS omim_id,
      cvs.variant_type AS _keyset_variant_type,
      cvs.genome_build AS _keyset_genome_build
    FROM ${qualifiedTable} cvs
    ${summaryWhereClause(whereParts)}
    ${orderBy}
    LIMIT $${limitParamIndex}
    OFFSET $${offsetParamIndex}`
}

export interface BuildSummaryResult {
  parts: SummaryQueryParts
  /** true → caller falls back to the live `buildQueryParts` path. */
  unavailable: boolean
  unavailableReason?: string
}

/**
 * Sort key → direct `cvs` column. Aggregate sorts in the live builder
 * (e.g. `ORDER BY carrier_count`) become direct column sorts on `cvs`.
 * `cadd_phred` maps to the stored `cadd` column.
 */
const SUMMARY_SORT_COLUMNS: Record<string, string> = {
  chr: 'cvs.chr',
  pos: 'cvs.pos',
  gene_symbol: 'cvs.gene_symbol',
  cdna: 'cvs.cdna',
  aa_change: 'cvs.aa_change',
  carrier_count: 'cvs.carrier_count',
  cohort_frequency: 'cvs.cohort_frequency',
  het_count: 'cvs.het_count',
  hom_count: 'cvs.hom_count',
  consequence: 'cvs.consequence',
  func: 'cvs.func',
  clinvar: 'cvs.clinvar',
  gnomad_af: 'cvs.gnomad_af',
  cadd_phred: 'cvs.cadd',
  transcript: 'cvs.transcript'
}

/**
 * Column-filter key → stored `cvs` column expression. Covers the base columns
 * the live builder filters in `addColumnFilters`; aggregate columns
 * (carrier_count, cohort_frequency, het_count, hom_count) are stored columns
 * here, so they map to plain columns rather than aggregate expressions.
 */
const SUMMARY_COLUMN_FILTER_SQL: Record<string, string> = {
  chr: 'cvs.chr',
  pos: 'cvs.pos',
  gene_symbol: 'cvs.gene_symbol',
  consequence: 'cvs.consequence',
  func: 'cvs.func',
  clinvar: 'cvs.clinvar',
  gnomad_af: 'cvs.gnomad_af',
  cadd_phred: 'cvs.cadd',
  transcript: 'cvs.transcript',
  carrier_count: 'cvs.carrier_count',
  cohort_frequency: 'cvs.cohort_frequency',
  het_count: 'cvs.het_count',
  hom_count: 'cvs.hom_count'
}

const NUMERIC_COLUMN_FILTERS = new Set<string>([
  'pos',
  'gnomad_af',
  'cadd_phred',
  'carrier_count',
  'cohort_frequency',
  'het_count',
  'hom_count'
])

/** Extension-table column keys (sv.*, cnv.*, str.*) from the variant registry. */
const EXTENSION_COLUMN_KEYS = new Set<string>(
  Object.keys(POSTGRES_VARIANT_COLUMN_DEFINITIONS).filter((key) => key.includes('.'))
)

function isNonEmptyArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0
}

/**
 * True iff any column filter targets a `variant_extensions` column. Sprint A
 * does not materialise extension aggregates into the summary, so such queries
 * fall through to the live builder.
 */
function hasExtensionPredicate(params: CohortSearchParams): boolean {
  if (params.column_filters === undefined) return false
  for (const column of Object.keys(params.column_filters)) {
    if (params.column_filters[column] === undefined) continue
    if (EXTENSION_COLUMN_KEYS.has(column)) return true
  }
  return false
}

function emptyParts(): SummaryQueryParts {
  return { joins: '', whereParts: [], orderBy: '', values: [], keyset: false }
}

function normalizeColumnFilterValue(column: string, value: string | number): string | number {
  if (!NUMERIC_COLUMN_FILTERS.has(column) || typeof value === 'number') return value
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : value
}

function buildColumnFilterCondition(
  column: string,
  expression: string,
  filter: ColumnFilter,
  addParam: (value: unknown) => string
): string {
  const { operator, value } = filter
  const isNumeric = NUMERIC_COLUMN_FILTERS.has(column)

  if (operator === 'in' && Array.isArray(value)) {
    if (value.length === 0) return ''
    return `${expression} IN (${value
      .map((item) => addParam(normalizeColumnFilterValue(column, item)))
      .join(', ')})`
  }

  if (operator === 'like' && typeof value === 'string') {
    if (value.trim() === '') return ''
    const pattern = `%${value}%`
    if (isNumeric) {
      return `${expression}::text ILIKE ${addParam(pattern)}`
    }
    return `${expression} ILIKE ${addParam(pattern)}`
  }

  if (
    (operator === '=' || operator === '!=') &&
    (typeof value === 'string' || typeof value === 'number')
  ) {
    return `${expression} ${operator} ${addParam(normalizeColumnFilterValue(column, value))}`
  }

  if (
    (operator === '<' || operator === '>' || operator === '<=' || operator === '>=') &&
    (typeof value === 'string' || typeof value === 'number')
  ) {
    const comparison = `${expression} ${operator} ${addParam(normalizeColumnFilterValue(column, value))}`
    // All summary column filters live in WHERE; mirror the live builder's
    // `includeEmpty` default for base WHERE columns (true).
    const includeEmpty = filter.includeEmpty ?? true
    return includeEmpty ? `(${expression} IS NULL OR ${comparison})` : comparison
  }

  return ''
}

export function buildSummaryQueryParts(
  params: CohortSearchParams,
  totalCases: number
): BuildSummaryResult {
  void totalCases // cohort_frequency is a stored column; total cases is not needed here.

  if (hasExtensionPredicate(params)) {
    return { parts: emptyParts(), unavailable: true, unavailableReason: 'extension_predicate' }
  }

  const whereParts: string[] = []
  const values: unknown[] = []
  const addParam = (value: unknown): string => {
    values.push(value)
    return `$${values.length}`
  }

  if (params.search_term !== undefined && params.search_term.trim() !== '') {
    const term = params.search_term.trim()
    const genomicMatch = term.match(/^(?:chr)?(\d{1,2}|X|Y|MT?):(\d+)$/i)
    if (genomicMatch !== null) {
      whereParts.push(
        `(cvs.chr = ${addParam(genomicMatch[1])} AND cvs.pos = ${addParam(Number(genomicMatch[2]))})`
      )
    } else {
      const searchPattern = `%${term}%`
      whereParts.push(`(
          cvs.gene_symbol ILIKE ${addParam(searchPattern)}
          OR cvs.consequence ILIKE ${addParam(searchPattern)}
          OR cvs.omim_mim_number ILIKE ${addParam(searchPattern)}
        )`)
    }
  }

  if (isNonEmptyArray(params.panel_intervals)) {
    // Pass-9 #7: mirror PostgresCohortRepository.buildQueryParts verbatim so
    // spanning SV/CNV variants overlap correctly.
    const intervalParts = params.panel_intervals.map(
      (interval) =>
        `(cvs.chr = ${addParam(interval.chr)} AND cvs.pos <= ${addParam(interval.end)} AND COALESCE(cvs.end_pos, cvs.pos) >= ${addParam(interval.start)})`
    )
    whereParts.push(`(${intervalParts.join(' OR ')})`)
  }

  if (params.gene_symbol !== undefined && params.gene_symbol !== '') {
    whereParts.push(`cvs.gene_symbol = ${addParam(params.gene_symbol)}`)
  }

  if (isNonEmptyArray(params.consequences)) {
    whereParts.push(
      `cvs.consequence IN (${params.consequences.map((value) => addParam(value)).join(', ')})`
    )
  }

  if (isNonEmptyArray(params.funcs)) {
    whereParts.push(`cvs.func IN (${params.funcs.map((value) => addParam(value)).join(', ')})`)
  }

  if (isNonEmptyArray(params.clinvars)) {
    whereParts.push(
      `cvs.clinvar IN (${params.clinvars.map((value) => addParam(value)).join(', ')})`
    )
  }

  if (params.gnomad_af_max !== undefined) {
    whereParts.push(`(cvs.gnomad_af IS NULL OR cvs.gnomad_af <= ${addParam(params.gnomad_af_max)})`)
  }

  if (params.cadd_min !== undefined) {
    whereParts.push(`(cvs.cadd IS NULL OR cvs.cadd >= ${addParam(params.cadd_min)})`)
  }

  if (params.genome_build !== undefined && params.genome_build !== '') {
    // Direct stored column — no `cases` join needed in the summary path.
    whereParts.push(`cvs.genome_build = ${addParam(params.genome_build)}`)
  }

  if (params.variant_type === 'snv') {
    whereParts.push("cvs.variant_type IN ('snv', 'indel')")
  } else if (params.variant_type !== undefined && params.variant_type !== '') {
    whereParts.push(`cvs.variant_type = ${addParam(params.variant_type)}`)
  }

  // Annotation flags — kept current by C5a, read as stored columns.
  if (params.starred_only === true) {
    whereParts.push('cvs.has_star = true')
  }

  if (params.has_comment === true) {
    whereParts.push('cvs.has_comment = true')
  }

  if (isNonEmptyArray(params.acmg_classifications)) {
    whereParts.push(
      `cvs.acmg_best IN (${params.acmg_classifications.map((value) => addParam(value)).join(', ')})`
    )
  }

  // Per-column typed filters → stored cvs columns (aggregates become plain
  // columns; HAVING disappears).
  if (params.column_filters !== undefined) {
    for (const column of Object.keys(params.column_filters)) {
      const filter = params.column_filters[column]
      if (filter === undefined) continue
      const expression = SUMMARY_COLUMN_FILTER_SQL[column]
      if (expression === undefined) continue
      const condition = buildColumnFilterCondition(column, expression, filter, addParam)
      if (condition !== '') whereParts.push(condition)
    }
  }

  // Aggregate predicates (HAVING → WHERE on stored columns).
  if (params.max_internal_af !== undefined) {
    whereParts.push(`cvs.cohort_frequency <= ${addParam(params.max_internal_af)}`)
  }

  if (params.carrier_count_min !== undefined) {
    whereParts.push(`cvs.carrier_count >= ${addParam(params.carrier_count_min)}`)
  }

  const sortKey =
    params.sort_by !== undefined && SUMMARY_SORT_COLUMNS[params.sort_by] !== undefined
      ? params.sort_by
      : 'carrier_count'
  const direction = params.sort_order === 'asc' ? 'asc' : 'desc'
  // Default carrier-count sort → all-ascending keyset order (idx_cvs_carrier_keyset).
  const keyset = isCohortKeysetSort(sortKey, direction)
  const orderBy = keyset
    ? cohortKeysetOrderByClause('cvs', 'postgres')
    : cohortOrderByClause(sortKey, SUMMARY_SORT_COLUMNS[sortKey], direction, 'cvs', 'postgres')

  return { parts: { joins: '', whereParts, orderBy, values, keyset }, unavailable: false }
}
