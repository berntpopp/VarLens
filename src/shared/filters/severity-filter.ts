/**
 * Filters on the two severity columns, `consequence` (impact) and `clinvar`
 * (#469): matched by normalised category, not by the stored text.
 *
 * The stored strings are whatever the annotation wrote: `pathogenic`,
 * `Pathogenic`, `Pathogenic|drug_response` are all ClinVar Pathogenic. A filter
 * value is mapped to its category by the shared severity configuration and
 * selects every row whose stored rank is that category's, in addition to the
 * rows with exactly that text, which it selected before. Saved filters and
 * presets keep working: their stored strings map to categories.
 *
 * One builder for the case view and the cohort view on both backends, so the
 * four sinks cannot drift. Pure SQL text.
 */
import { isSeverityKey, severityFilterParts, type SeverityKey } from '../config/severity.config'

export interface SeverityFilterTarget {
  /** Whitelisted SQL reference to the text column. */
  column: string
  /** SQL giving the row's rank for the key (a column, or an on-the-fly expression). */
  rank: string
  /** Binds a text value and returns its placeholder. */
  bind: (value: string) => string
}

/** The rank column of a severity key. */
export const SEVERITY_RANK_COLUMN: Readonly<Record<SeverityKey, string>> = {
  consequence: 'impact_rank',
  clinvar: 'clinvar_rank'
}

/**
 * Predicate for `key IN values` (or `key = value`), or for its negation with
 * `negate`. Null when the key is not a severity column or there are no values:
 * the caller then applies its ordinary text comparison, or nothing.
 */
export function severityFilterSql(
  key: string,
  values: readonly unknown[],
  target: SeverityFilterTarget,
  negate = false
): string | null {
  if (!isSeverityKey(key) || values.length === 0) return null
  const { ranks } = severityFilterParts(key, values)
  const texts = [...new Set(values.map((value) => String(value)))]
  const parts: string[] = []
  // Ranks are integers from the configuration, never user input.
  if (ranks.length > 0) parts.push(`${target.rank} IN (${ranks.join(', ')})`)
  // The value's own text always matches as well: a value that is no known
  // category, and a row whose rank was not written by the import pipeline.
  parts.push(`${target.column} IN (${texts.map(target.bind).join(', ')})`)
  const match = parts.length === 1 ? parts[0] : `(${parts.join(' OR ')})`
  // Like `column != value`, a negation does not select rows without a value.
  return negate ? `(${target.column} IS NOT NULL AND NOT ${match})` : match
}

/** The values of an `in`, `=` or `!=` column filter, or null for another operator. */
export function severityFilterOperands(
  operator: string,
  value: unknown
): { values: unknown[]; negate: boolean } | null {
  if (operator === 'in' && Array.isArray(value)) return { values: value, negate: false }
  if (
    (operator === '=' || operator === '!=') &&
    (typeof value === 'string' || typeof value === 'number')
  ) {
    return { values: [value], negate: operator === '!=' }
  }
  return null
}
