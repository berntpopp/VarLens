import { isSeverityKey } from '../../shared/config/severity.config'
import {
  SEVERITY_RANK_COLUMN,
  severityFilterOperands,
  severityFilterSql,
  type SeverityFilterTarget
} from '../../shared/filters/severity-filter'
import type { ColumnFilter, ColumnFiltersParam } from '../../shared/types/column-filters'
import { isExtensionColumnKey } from './variant-extension-registry'
import { buildNullCheckSql, isNullCheckOperator } from '../../shared/filters/column-null-check'
import { BASE_SORTABLE_COLUMNS } from './VariantFilterBuilder'
import {
  assertValidColumnFilterValues,
  NUMERIC_COLUMN_FILTER_KEYS
} from '../../shared/filters/column-filter-validation'
import { COHORT_FREQUENCY_KEY, COHORT_FREQUENCY_SQL } from './cohort-frequency-sql'

export interface BuildBaseWhereContext {
  /** SQL alias for base columns: 'v' for variants-backed paths, 'cvs' for cohort listing. */
  baseAlias: string
  /** Scope-specific invariants. */
  scope: 'case' | 'cohort-listing' | 'cohort-burden'
}

export interface BaseFilterInput {
  gnomad_af_max?: number
  cadd_min?: number
  consequences?: string[]
  clinvars?: string[]
  funcs?: string[]
  gene_symbol?: string
  gene_list?: string[]
  max_internal_af?: number
  starred_only?: boolean
  has_comment?: boolean
  acmg_classifications?: string[]
  carrier_count_min?: number
  carrier_count_max?: number
  variant_type?: string
  genome_build?: string
  column_filters?: ColumnFiltersParam
}

export interface BuildBaseWhereResult {
  sql: string
  params: (string | number)[]
  /**
   * True when a predicate uses the read-time cohort frequency: the query must
   * then include `COHORT_BUILD_TOTALS_JOIN` (cohort-listing scope only).
   */
  needsBuildTotals: boolean
}

export function buildBaseWhere(
  filters: BaseFilterInput,
  ctx: BuildBaseWhereContext
): BuildBaseWhereResult {
  // Same value/column-type check as every other builder on both backends (#447).
  assertValidColumnFilterValues(filters.column_filters)
  const conditions: string[] = []
  const params: (string | number)[] = []
  const { baseAlias, scope } = ctx
  let needsBuildTotals = false
  const q = (col: string) => `${baseAlias}.${col}`

  // Scope-specific invariants
  if (scope === 'cohort-burden') {
    conditions.push(`${q('gene_symbol')} IS NOT NULL`)
    conditions.push(`${q('gene_symbol')} != ''`)
  }

  // variant_type narrowing with SNV/indel collapse in cohort-listing scope
  if (filters.variant_type !== undefined && filters.variant_type !== '') {
    if (scope === 'cohort-listing' && filters.variant_type === 'snv') {
      conditions.push(`${q('variant_type')} IN ('snv', 'indel')`)
    } else {
      conditions.push(`${q('variant_type')} = ?`)
      params.push(filters.variant_type)
    }
  }

  if (filters.genome_build !== undefined && filters.genome_build !== '') {
    conditions.push(`${q('genome_build')} = ?`)
    params.push(filters.genome_build)
  }

  // Cohort-summary-only fields (the derived cohort frequency, carrier_count,
  // has_star, has_comment, acmg_best) live on cohort_variant_summary, not on the
  // base variants table. They must be silently dropped for scopes that
  // query variants directly (case, cohort-burden) to avoid emitting
  // SQL that references non-existent columns. Callers needing these
  // semantics in a non-cohort-listing scope must JOIN to the appropriate
  // annotation table themselves.
  const isCohortSummaryScope = scope === 'cohort-listing'

  // Typed stable fields (NULL-inclusive for numeric thresholds)
  if (filters.gnomad_af_max !== undefined) {
    conditions.push(`(${q('gnomad_af')} IS NULL OR ${q('gnomad_af')} <= ?)`)
    params.push(filters.gnomad_af_max)
  }
  if (filters.cadd_min !== undefined) {
    conditions.push(`(${q('cadd')} IS NULL OR ${q('cadd')} >= ?)`)
    params.push(filters.cadd_min)
  }
  if (
    isCohortSummaryScope &&
    filters.max_internal_af !== undefined &&
    filters.max_internal_af > 0
  ) {
    // 0 means "no frequency filter"; a row without a frequency is kept.
    conditions.push(`(${COHORT_FREQUENCY_SQL} IS NULL OR ${COHORT_FREQUENCY_SQL} <= ?)`)
    params.push(filters.max_internal_af)
    needsBuildTotals = true
  }
  if (
    isCohortSummaryScope &&
    filters.carrier_count_min !== undefined &&
    filters.carrier_count_min > 0
  ) {
    conditions.push(`${q('carrier_count')} >= ?`)
    params.push(filters.carrier_count_min)
  }
  if (
    isCohortSummaryScope &&
    filters.carrier_count_max !== undefined &&
    filters.carrier_count_max >= 1
  ) {
    // carrier_count is NOT NULL on the summary: no NULL branch.
    conditions.push(`${q('carrier_count')} <= ?`)
    params.push(filters.carrier_count_max)
  }

  // Impact and ClinVar match by normalised category (severity-filter.ts).
  const bySeverity = (key: 'consequence' | 'clinvar', values?: string[]): void => {
    const clause = severityFilterSql(key, values ?? [], severityTarget(key, baseAlias, params))
    if (clause !== null) conditions.push(clause)
  }
  bySeverity('consequence', filters.consequences)
  if (filters.funcs !== undefined && filters.funcs.length > 0) {
    const ph = filters.funcs.map(() => '?').join(', ')
    conditions.push(`${q('func')} IN (${ph})`)
    params.push(...filters.funcs)
  }
  bySeverity('clinvar', filters.clinvars)
  if (
    isCohortSummaryScope &&
    filters.acmg_classifications !== undefined &&
    filters.acmg_classifications.length > 0
  ) {
    const ph = filters.acmg_classifications.map(() => '?').join(', ')
    conditions.push(`${q('acmg_best')} IN (${ph})`)
    params.push(...filters.acmg_classifications)
  }

  if (filters.gene_symbol !== undefined && filters.gene_symbol !== '') {
    conditions.push(`${q('gene_symbol')} LIKE ?`)
    params.push(`%${filters.gene_symbol}%`)
  }
  if (filters.gene_list !== undefined && filters.gene_list.length > 0) {
    const ph = filters.gene_list.map(() => '?').join(', ')
    conditions.push(`${q('gene_symbol')} IN (${ph})`)
    params.push(...filters.gene_list)
  }

  if (isCohortSummaryScope && filters.starred_only === true) {
    conditions.push(`${q('has_star')} = 1`)
  }
  if (isCohortSummaryScope && filters.has_comment === true) {
    conditions.push(`${q('has_comment')} = 1`)
  }

  // Bare-key column_filters (skip extension dotted keys — per-path helpers handle those)
  if (filters.column_filters !== undefined) {
    for (const [key, filter] of Object.entries(filters.column_filters)) {
      if (isExtensionColumnKey(key)) continue
      const clause = translateColumnFilter(key, filter, baseAlias, params, scope)
      if (clause === null) continue
      conditions.push(clause)
      if (isCohortSummaryScope && key === COHORT_FREQUENCY_KEY) needsBuildTotals = true
    }
  }

  return { sql: conditions.join(' AND '), params, needsBuildTotals }
}

const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/** Where a severity filter looks on `baseAlias` (variants or the cohort summary). */
function severityTarget(
  key: 'consequence' | 'clinvar',
  baseAlias: string,
  params: (string | number)[]
): SeverityFilterTarget {
  return {
    column: `${baseAlias}.${key}`,
    rank: `${baseAlias}.${SEVERITY_RANK_COLUMN[key]}`,
    bind: (value) => {
      params.push(value)
      return '?'
    }
  }
}

/**
 * SQL column names on the `variants` table that VariantFilterBuilder already
 * treats as sortable/filterable for its own column_filters path. `case` and
 * `cohort-burden` scopes query `variants` directly (baseAlias `v`) and pass
 * `column_filters` straight into `buildBaseWhere` with no pre-remap step, so
 * bare keys for those two scopes are gated through this same allowlist
 * rather than trusting any syntactically valid identifier (S7 info fix) —
 * `IDENTIFIER_RE` alone blocks metacharacters but not an unintended-but-valid
 * column reference.
 */
const VARIANTS_TABLE_COLUMN_ALLOWLIST = new Set(Object.values(BASE_SORTABLE_COLUMNS))

function translateColumnFilter(
  column: string,
  filter: ColumnFilter,
  baseAlias: string,
  params: (string | number)[],
  scope: BuildBaseWhereContext['scope']
): string | null {
  if (!IDENTIFIER_RE.test(column)) return null
  // cohort-listing scope is exempt: cohort.ts remaps + validates bare keys
  // against its own SORTABLE_COLUMNS (cohort_variant_summary columns,
  // including cohort-only fields like carrier_count/cohort_frequency that
  // don't exist on `variants`) before ever calling buildBaseWhere. Applying
  // the variants-table allowlist here too would incorrectly reject those
  // legitimate cohort-only fields — a cohort-parity regression.
  if (
    (scope === 'case' || scope === 'cohort-burden') &&
    !VARIANTS_TABLE_COLUMN_ALLOWLIST.has(column)
  ) {
    return null
  }
  // The cohort frequency is not a stored column: it is derived at read time.
  const col =
    scope === 'cohort-listing' && column === COHORT_FREQUENCY_KEY
      ? COHORT_FREQUENCY_SQL
      : `${baseAlias}.${column}`
  const { operator, value, includeEmpty } = filter
  const nullBranch = includeEmpty !== false

  if (isNullCheckOperator(operator)) {
    return buildNullCheckSql(col, operator, NUMERIC_COLUMN_FILTER_KEYS.has(column), 'sqlite')
  }
  const severity = isSeverityKey(column) ? severityFilterOperands(operator, value) : null
  if (isSeverityKey(column) && severity !== null) {
    const target = severityTarget(column, baseAlias, params)
    return severityFilterSql(column, severity.values, target, severity.negate)
  }
  if (operator === 'in' && Array.isArray(value)) {
    if (value.length === 0) return null
    const ph = value.map(() => '?').join(', ')
    params.push(...value)
    return `${col} IN (${ph})`
  }
  if (operator === 'like' && typeof value === 'string') {
    if (value.trim() === '') return null
    params.push(`%${value}%`)
    return `${col} LIKE ? COLLATE NOCASE`
  }
  if ((operator === '=' || operator === '!=') && !Array.isArray(value)) {
    params.push(bindComparisonValue(column, value))
    return `${col} ${operator} ?`
  }
  if (['<', '>', '<=', '>='].includes(operator) && !Array.isArray(value)) {
    params.push(bindComparisonValue(column, value))
    return nullBranch ? `(${col} IS NULL OR ${col} ${operator} ?)` : `${col} ${operator} ?`
  }
  return null
}

/**
 * Text columns get a text parameter. better-sqlite3 binds every JS number as a
 * REAL, which SQLite renders as `'7.0'` before comparing it with a TEXT
 * column — so an unconverted `chr = 7` could never match the stored `'7'`.
 * Numeric columns keep the caller's value: SQLite applies the column's numeric
 * affinity to a text parameter such as `'20'`.
 */
function bindComparisonValue(column: string, value: string | number): string | number {
  return NUMERIC_COLUMN_FILTER_KEYS.has(column) ? value : String(value)
}
