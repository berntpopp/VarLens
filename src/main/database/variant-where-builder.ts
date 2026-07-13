import type { ColumnFilter, ColumnFiltersParam } from '../../shared/types/column-filters'
import { isExtensionColumnKey } from './variant-extension-registry'
import { BASE_SORTABLE_COLUMNS } from './VariantFilterBuilder'

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
  variant_type?: string
  genome_build?: string
  column_filters?: ColumnFiltersParam
}

export interface BuildBaseWhereResult {
  sql: string
  params: (string | number)[]
}

export function buildBaseWhere(
  filters: BaseFilterInput,
  ctx: BuildBaseWhereContext
): BuildBaseWhereResult {
  const conditions: string[] = []
  const params: (string | number)[] = []
  const { baseAlias, scope } = ctx
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

  // Cohort-summary-only fields (cohort_frequency, carrier_count, has_star,
  // has_comment, acmg_best) live on cohort_variant_summary, not on the
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
    conditions.push(`(${q('cohort_frequency')} IS NULL OR ${q('cohort_frequency')} <= ?)`)
    params.push(filters.max_internal_af)
  }
  if (
    isCohortSummaryScope &&
    filters.carrier_count_min !== undefined &&
    filters.carrier_count_min > 0
  ) {
    conditions.push(`${q('carrier_count')} >= ?`)
    params.push(filters.carrier_count_min)
  }

  if (filters.consequences !== undefined && filters.consequences.length > 0) {
    const ph = filters.consequences.map(() => '?').join(', ')
    conditions.push(`${q('consequence')} IN (${ph})`)
    params.push(...filters.consequences)
  }
  if (filters.funcs !== undefined && filters.funcs.length > 0) {
    const ph = filters.funcs.map(() => '?').join(', ')
    conditions.push(`${q('func')} IN (${ph})`)
    params.push(...filters.funcs)
  }
  if (filters.clinvars !== undefined && filters.clinvars.length > 0) {
    const ph = filters.clinvars.map(() => '?').join(', ')
    conditions.push(`${q('clinvar')} IN (${ph})`)
    params.push(...filters.clinvars)
  }
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
      if (clause !== null) conditions.push(clause)
    }
  }

  return { sql: conditions.join(' AND '), params }
}

const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

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
  const col = `${baseAlias}.${column}`
  const { operator, value, includeEmpty } = filter
  const nullBranch = includeEmpty !== false

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
    params.push(value)
    return `${col} ${operator} ?`
  }
  if (['<', '>', '<=', '>='].includes(operator) && !Array.isArray(value)) {
    params.push(value)
    return nullBranch ? `(${col} IS NULL OR ${col} ${operator} ?)` : `${col} ${operator} ?`
  }
  return null
}
