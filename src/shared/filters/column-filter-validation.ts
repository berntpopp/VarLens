/**
 * Backend-independent validation of per-column filter values (issue #447).
 *
 * A comparison such as `cadd < 'abc'` has no meaning, and the two backends
 * used to disagree about it: SQLite orders every number before every text
 * value, so the filter silently passed all rows, while PostgreSQL failed the
 * whole query with `22P02 invalid input syntax`. Every query builder calls
 * {@link assertValidColumnFilterValues} before it emits SQL, so both backends
 * now reject such a filter with the same error.
 */
import type { ColumnFiltersParam } from '../types/column-filters'
import { isNullCheckOperator } from './column-null-check'

/**
 * Column-filter keys whose column holds numbers.
 *
 * Covers the case view (`cadd`), the cohort view (`cadd_phred`, carrier
 * aggregates) and the extension tables (`cnv.copy_number`). Must stay in step
 * with `POSTGRES_VARIANT_COLUMN_DEFINITIONS` — locked by
 * `tests/main/storage/postgres-panel-interval-resolver.test.ts`.
 */
export const NUMERIC_COLUMN_FILTER_KEYS: ReadonlySet<string> = new Set([
  // variants table
  'pos',
  'gnomad_af',
  'cadd',
  'qual',
  'hpo_sim_score',
  'end_pos',
  'sv_length',
  // cohort view
  'cadd_phred',
  'carrier_count',
  'cohort_frequency',
  'het_count',
  'hom_count',
  // variant_sv
  'sv.support',
  'sv.pe_support',
  'sv.sr_support',
  'sv.dr',
  'sv.dv',
  'sv.vaf',
  'sv.cipos_left',
  'sv.cipos_right',
  'sv.ciend_left',
  'sv.ciend_right',
  'sv.stdev_len',
  'sv.stdev_pos',
  // variant_cnv
  'cnv.copy_number',
  'cnv.copy_number_quality',
  'cnv.homozygosity_ref',
  'cnv.homozygosity_alt',
  'cnv.sm',
  'cnv.bin_count',
  // variant_str
  'str.repeat_length',
  'str.ref_copies',
  'str.normal_max',
  'str.pathologic_min',
  'str.locus_coverage'
])

/** Thrown when a column filter carries a value its column cannot be compared with. */
export class ColumnFilterValueError extends Error {
  constructor(
    readonly column: string,
    readonly value: unknown
  ) {
    super(
      `Invalid numeric value for column filter "${column}": ${JSON.stringify(value)} is not a number`
    )
    this.name = 'ColumnFilterValueError'
  }
}

/**
 * Whether a filter value can be compared with a numeric column. Uses the same
 * `Number()` coercion both backends apply to string values, so anything that
 * passes is bound as the same number on SQLite and PostgreSQL.
 *
 * A blank string is NOT a number even though `Number('')` is `0`: accepting it
 * turned "no value" into `= 0`. "Has no value" is the `is_null` operator.
 */
function isNumericFilterValue(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'string') return value.trim() !== '' && Number.isFinite(Number(value))
  return false
}

/**
 * Reject comparison (`= != < > <= >=`) and `in` filters on numeric columns
 * whose value is not a finite number. `like` filters are textual by design and
 * pass through untouched, null checks have no value, as do filters on text columns and unknown keys
 * (each backend decides separately whether a key is filterable at all).
 *
 * @throws {ColumnFilterValueError} for the first offending filter.
 */
export function assertValidColumnFilterValues(filters: ColumnFiltersParam | undefined): void {
  if (filters === undefined) return

  for (const [column, filter] of Object.entries(filters)) {
    if (filter === undefined || !NUMERIC_COLUMN_FILTER_KEYS.has(column)) continue
    const { operator, value } = filter
    // Null checks carry no value to validate.
    if (operator === 'like' || isNullCheckOperator(operator)) continue

    const values = Array.isArray(value) ? value : [value]
    for (const item of values) {
      if (!isNumericFilterValue(item)) throw new ColumnFilterValueError(column, item)
    }
  }
}
