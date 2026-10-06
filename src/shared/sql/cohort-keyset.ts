/**
 * Keyset ("seek") order for the cohort view's default sort, shared by the
 * SQLite and PostgreSQL summary-table queries.
 *
 * The default cohort order is `carrier_count DESC NULLS LAST` followed by the
 * ascending genomic tiebreaker. A row-value seek `(a, b, …) > (?, ?, …)` only
 * equals an ORDER BY whose terms all run in one direction, so the carrier term
 * is expressed as an ascending key that sorts exactly like
 * `carrier_count DESC NULLS LAST`:
 *
 *     (-COALESCE(carrier_count, -1)) ASC
 *
 * (carriers are ≥ 1, so a NULL maps to +1 and sorts after every real count).
 * The full order adds `variant_type, genome_build`, the remaining primary-key
 * columns, so it is total and a cursor never skips a tied row.
 *
 * Both backends index this exact expression list (`idx_cvs_carrier_keyset`,
 * SQLite migration v36 / PostgreSQL 0020); emit it only through these helpers.
 */
import { chrRankSql, type SqlDialect } from './chromosome-order'

export const COHORT_KEYSET_INDEX = 'idx_cvs_carrier_keyset'

/** Cursor fields, in seek order (raw summary-row values). */
export const COHORT_KEYSET_FIELDS = [
  'carrier_count',
  'chr',
  'pos',
  'ref',
  'alt',
  'variant_type',
  'genome_build'
] as const

export type CohortKeysetField = (typeof COHORT_KEYSET_FIELDS)[number]

const INTEGER_FIELDS: ReadonlySet<CohortKeysetField> = new Set(['carrier_count', 'pos'])

export function isIntegerKeysetField(field: CohortKeysetField): boolean {
  return INTEGER_FIELDS.has(field)
}

function qualify(alias: string, column: string): string {
  return alias === '' ? column : `${alias}.${column}`
}

/** Ascending sort key equivalent to `carrier_count DESC NULLS LAST`. */
export function cohortCarrierKeySql(operand: string): string {
  return `(-COALESCE(${operand}, -1))`
}

/** True for the sort that the keyset order serves (the cohort default). */
export function isCohortKeysetSort(sortKey: string, direction: 'asc' | 'desc'): boolean {
  return sortKey === 'carrier_count' && direction === 'desc'
}

function chrNameSql(operand: string, dialect: SqlDialect): string {
  return dialect === 'postgres' ? `${operand} COLLATE "C"` : operand
}

/** Order terms (no direction) — also the index column list. */
export function cohortKeysetTerms(alias: string, dialect: SqlDialect): string[] {
  const chr = qualify(alias, 'chr')
  return [
    cohortCarrierKeySql(qualify(alias, 'carrier_count')),
    chrRankSql(chr),
    chrNameSql(chr, dialect),
    qualify(alias, 'pos'),
    qualify(alias, 'ref'),
    qualify(alias, 'alt'),
    qualify(alias, 'variant_type'),
    qualify(alias, 'genome_build')
  ]
}

export function cohortKeysetOrderByClause(alias: string, dialect: SqlDialect): string {
  return `ORDER BY ${cohortKeysetTerms(alias, dialect)
    .map((term) => `${term} ASC`)
    .join(', ')}`
}

const RANK_PLACEHOLDER = 'keyset_chr_param'

/**
 * `(order terms) > (cursor values)`. `placeholders[i]` is the bound parameter
 * for COHORT_KEYSET_FIELDS[i]. The chromosome placeholder is repeated inside
 * the rank expression and the name term, so it must be a reusable reference:
 * `$n::text` in PostgreSQL, a named `@param` in SQLite (a plain `?` would
 * consume a new positional value at every occurrence).
 */
export function cohortKeysetPredicate(
  alias: string,
  dialect: SqlDialect,
  placeholders: readonly string[]
): string {
  const [carrier, chr, pos, ref, alt, variantType, genomeBuild] = placeholders
  const rank = chrRankSql(RANK_PLACEHOLDER).split(RANK_PLACEHOLDER).join(chr)
  const right = [
    cohortCarrierKeySql(carrier),
    rank,
    chrNameSql(chr, dialect),
    pos,
    ref,
    alt,
    variantType,
    genomeBuild
  ]
  return `(${cohortKeysetTerms(alias, dialect).join(', ')}) > (${right.join(', ')})`
}
