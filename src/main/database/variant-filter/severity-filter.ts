/**
 * Case-view filters on impact and ClinVar, matched by normalised category
 * (src/shared/filters/severity-filter.ts) with Kysely-bound parameters.
 */
import { sql } from 'kysely'

import type { SeverityKey } from '../../../shared/config/severity.config'
import { SEVERITY_RANK_COLUMN, severityFilterSql } from '../../../shared/filters/severity-filter'
import type { VariantQueryBuilder } from './query-types'

/** Marks where a bound value goes in the SQL text; cannot occur in the text itself. */
const PLACEHOLDER = '\u0000'

/** `key IN values` (or its negation) on the `variants` table. */
export function whereSeverity(
  query: VariantQueryBuilder,
  key: SeverityKey,
  values: readonly unknown[],
  negate = false
): VariantQueryBuilder {
  const bound: string[] = []
  const text = severityFilterSql(
    key,
    values,
    {
      column: `variants.${key}`,
      rank: `variants.${SEVERITY_RANK_COLUMN[key]}`,
      bind: (value) => {
        bound.push(value)
        return PLACEHOLDER
      }
    },
    negate
  )
  if (text === null) return query
  // The text is built from whitelisted column names and configured integers;
  // every user value is bound.
  const pieces = text.split(PLACEHOLDER)
  const fragments = pieces.flatMap((piece, index) =>
    index < bound.length ? [sql.raw(piece), sql`${bound[index]}`] : [sql.raw(piece)]
  )
  return query.where(sql<boolean>`${sql.join(fragments, sql.raw(''))}`)
}
