/**
 * "Has no value" / "has a value" column filters, shared by every query builder
 * on both backends.
 *
 * The DSL's `column is:null` used to travel as `{ operator: '=', value: '' }`.
 * No builder could tell that apart from a real comparison, so on a numeric
 * column both backends coerced `''` to `0` and returned the rows whose value
 * IS zero — the opposite of what was asked. It is now an operator of its own,
 * and every builder emits the SQL from {@link buildNullCheckSql}, so SQLite
 * and PostgreSQL cannot disagree about what "empty" means:
 *
 * - numeric column: the value is NULL;
 * - text column: the value is NULL or the empty string (imports store both
 *   for "not annotated").
 */
import type { ColumnFilterOperator } from '../types/column-filters'

export type NullCheckOperator = Extract<ColumnFilterOperator, 'is_null' | 'not_null'>

export function isNullCheckOperator(operator: string): operator is NullCheckOperator {
  return operator === 'is_null' || operator === 'not_null'
}

/**
 * SQL predicate for a null-check filter. Takes no bound parameters.
 *
 * @param expression Column reference or aggregate — from an internal
 *                   allowlist, never user input.
 * @param numeric    Whether the column holds numbers (see
 *                   `NUMERIC_COLUMN_FILTER_KEYS`).
 * @param dialect    PostgreSQL needs a cast before comparing a non-text
 *                   column (integer flags, enums) with `''`.
 */
export function buildNullCheckSql(
  expression: string,
  operator: NullCheckOperator,
  numeric: boolean,
  dialect: 'sqlite' | 'postgres'
): string {
  if (numeric) {
    return operator === 'is_null' ? `${expression} IS NULL` : `${expression} IS NOT NULL`
  }
  const text = dialect === 'postgres' ? `${expression}::text` : expression
  return operator === 'is_null'
    ? `(${expression} IS NULL OR ${text} = '')`
    : `(${expression} IS NOT NULL AND ${text} <> '')`
}
