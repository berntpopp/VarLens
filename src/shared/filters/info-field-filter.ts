/**
 * Case-view filters on custom VCF INFO values (`info.<KEY>`, issue #538).
 *
 * INFO fields VarLens does not map to a column are kept as raw strings in the
 * `variants.info_json` object (`src/main/import/vcf/info-field-registry.ts`):
 * `{"DP":"35","TAGS":"a,b","FLAG":""}`. The header's Type/Number is kept only
 * in the case field dictionary, for autocomplete hints (`case-info-fields.ts`);
 * the filter does not use it, so a value's type is decided per row, the same
 * way on both backends:
 *
 * - **missing**: the key is absent or holds the VCF missing value `.`
 *   (`is_null`); a Flag is stored as `''` and counts as present.
 * - **numeric scalar**: a JSON number of at most 64 characters with an
 *   exponent of at most three digits. Only these rows take part in numeric
 *   comparisons — text, lists (`1,2`), flags and missing values never match
 *   `<`/`>` and are never coerced (no `'abc'` → 0, no string ordering).
 * - `=` / `in` match the exact stored text, or — for a numeric filter value —
 *   a numerically equal scalar (`=:0` matches `0` and `0.0`, never `.`).
 *   `!=` is their negation over rows that hold a value.
 *
 * The key is validated against the VCF INFO ID grammar and bound as a
 * parameter like every value. Lists (Number != 1) cannot be compared
 * element-wise yet, so a list-shaped filter value is rejected.
 *
 * Row-side twin (the shortlist rule evaluator): `info-value.ts`.
 */
import type { ColumnFilter } from '../types/column-filters'

export const INFO_FIELD_PREFIX = 'info.'

/** VCF 4.3 INFO ID grammar (`1000G` is its one historical exception), capped at 64. */
const INFO_KEY_RE = /^(?:[A-Za-z_][0-9A-Za-z_.]{0,63}|1000G)$/

/** The INFO key of an `info.<KEY>` filter column, or null for any other column. */
export function infoFieldKey(column: string): string | null {
  return column.startsWith(INFO_FIELD_PREFIX) ? column.slice(INFO_FIELD_PREFIX.length) : null
}

export function isValidInfoKey(key: string): boolean {
  return INFO_KEY_RE.test(key)
}

/** A finite number as both backends bind it; blank text is not a number. */
function numericValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

const RANGE_OPERATORS = new Set(['<', '>', '<=', '>='])

/** Why an `info.<KEY>` filter cannot run, or null when it can. */
export function infoFieldFilterProblem(column: string, filter: ColumnFilter): string | null {
  const key = infoFieldKey(column) ?? ''
  if (!isValidInfoKey(key)) return `"${key}" is not a valid INFO field name`
  const values = Array.isArray(filter.value) ? filter.value : [filter.value]
  if (RANGE_OPERATORS.has(filter.operator) && numericValue(filter.value) === null) {
    return `INFO field ${key}: '${filter.operator}' needs a number, got ${JSON.stringify(filter.value)}`
  }
  if (filter.operator !== 'like' && values.some((v) => typeof v === 'string' && v.includes(','))) {
    return `INFO field ${key}: list values (Number other than 1) cannot be filtered yet`
  }
  return null
}

export interface InfoFieldSqlTarget {
  dialect: 'sqlite' | 'postgres'
  /** Internal column reference holding the INFO JSON text, e.g. `variants.info_json`. */
  infoJson: string
  /** Binds a value and returns its placeholder; called once per occurrence, in text order. */
  bind: (value: string | number) => string
}

// JSON-number shape for PostgreSQL, matching SQLite's json_valid + json_type check.
const PG_NUMERIC_RE = `'^[ \\t\\n\\r]*-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][-+]?[0-9]{1,3})?[ \\t\\n\\r]*$'`

/**
 * SQL predicate for one `info.<KEY>` filter (validated with
 * {@link infoFieldFilterProblem} first), or null when it filters nothing.
 */
export function infoFieldFilterSql(
  key: string,
  filter: ColumnFilter,
  target: InfoFieldSqlTarget
): string | null {
  const { dialect, infoJson, bind } = target
  const sqlite = dialect === 'sqlite'
  // A fresh bind per occurrence: SQLite placeholders are positional.
  const x = (): string =>
    sqlite
      ? `json_extract(${infoJson}, ${bind(`$."${key}"`)})`
      : `(${infoJson}::jsonb ->> ${bind(key)}::text)`
  // CASE, not AND: neither engine promises to evaluate the guard before the cast.
  const num = (): string => {
    if (!sqlite) {
      const v = x()
      return `(CASE WHEN char_length(${v}) <= 64 AND ${v} ~ ${PG_NUMERIC_RE} THEN ${v}::numeric END)`
    }
    return `(CASE WHEN json_valid(${x()}) THEN CASE WHEN json_type(${x()}) IN ('integer', 'real') AND length(${x()}) <= 64 AND ${x()} NOT GLOB '*[eE]*[0-9][0-9][0-9][0-9]*' THEN CAST(${x()} AS REAL) END END)`
  }
  const bindNum = (n: number): string => (sqlite ? bind(n) : `${bind(n)}::numeric`)
  const present = (): string => `(${x()} IS NOT NULL AND ${x()} <> '.')`

  const { operator, value } = filter
  const values = (Array.isArray(value) ? value : [value]).map(String)
  const nums = values.map(numericValue).filter((n): n is number => n !== null)
  const equals = (): string | null => {
    if (values.length === 0) return null
    const text = `${x()} IN (${values.map((v) => bind(v)).join(', ')})`
    if (nums.length === 0) return text
    return `(${text} OR ${num()} IN (${nums.map(bindNum).join(', ')}))`
  }

  switch (operator) {
    case 'is_null':
      return `NOT ${present()}`
    case 'not_null':
      return present()
    case 'like': {
      if (values[0].trim() === '') return null
      const value = x() // binds in text order: SQLite placeholders are positional
      const pattern = bind(`%${values[0].replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
      return sqlite
        ? `${value} LIKE ${pattern} ESCAPE '\\' COLLATE NOCASE`
        : `${value} ILIKE ${pattern} ESCAPE '\\'`
    }
    case '=':
    case 'in':
      return equals()
    case '!=': {
      if (values.length === 0) return null
      const hasValue = present() // before equals(): binds must follow text order
      return `(${hasValue} AND NOT COALESCE(${equals()}, FALSE))`
    }
    default:
      // Range: validated to carry a number.
      return `${num()} ${operator} ${bindNum(nums[0])}`
  }
}
