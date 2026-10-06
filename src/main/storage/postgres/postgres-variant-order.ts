/**
 * ORDER BY construction and keyset ("seek") pagination for the Postgres case
 * variant list (2026-10 blocking audit, D-3).
 *
 * The ORDER BY comes from the shared natural-chromosome helpers
 * (src/shared/sql/chromosome-order.ts) so it matches
 * `idx_variants_case_chr_rank (case_id, rank, chr COLLATE "C", pos, id)`
 * (migration 0017). OFFSET pagination makes page N cost O(N × page size);
 * keyset pagination resumes after the previous page's last row with a
 * row-value predicate the index can seek to:
 *
 *     WHERE case_id = $1
 *       AND (rank(v.chr), v.chr COLLATE "C", v.pos, v.id)
 *         > (rank($c), $c COLLATE "C", $pos, $id)
 *     ORDER BY rank(v.chr), v.chr COLLATE "C", v.pos, v.id LIMIT n
 *
 * A row-value comparison equals the ORDER BY only when every term is
 * ascending and NOT NULL, so keyset is used only when every resolved term is
 * in KEYSET_TERMS and ASC; every other sort falls back to OFFSET. The rank is
 * recomputed in SQL from the cursor's `chr` (same expression as the column
 * side), so the cursor carries only raw column values. Cursors are opaque and
 * bound to the order terms and the filter; a stale cursor degrades to OFFSET.
 */
import { createHash } from 'node:crypto'

import {
  buildVariantOrderTerms,
  chrRankSql,
  type ResolvedVariantSort
} from '../../../shared/sql/chromosome-order'
import type { SortItem, VariantFilter } from '../../../shared/types/database'

export interface PostgresOrderTerm {
  /** Full term without direction, e.g. `v.chr COLLATE "C"`. */
  sql: string
  direction: 'ASC' | 'DESC'
  nullsLast: boolean
}

export interface KeysetColumn {
  /** Row field carrying the raw value in query results (`v.*` projection). */
  field: string
  cast: 'text' | 'bigint'
  /** Apply the term's expression to the bound parameter placeholder. */
  wrap: (placeholder: string) => string
}

const RANK_PLACEHOLDER = 'keyset_chr_param'
const rankOfParam = (placeholder: string): string =>
  chrRankSql(RANK_PLACEHOLDER).split(RANK_PLACEHOLDER).join(placeholder)

/** Ascending NOT NULL order terms that can take part in a row-value seek. */
export const KEYSET_TERMS: Readonly<Record<string, KeysetColumn>> = {
  [chrRankSql('v.chr')]: { field: 'chr', cast: 'text', wrap: rankOfParam },
  'v.chr COLLATE "C"': { field: 'chr', cast: 'text', wrap: (p) => `${p} COLLATE "C"` },
  'v.pos': { field: 'pos', cast: 'bigint', wrap: (p) => p },
  'v.id': { field: 'id', cast: 'bigint', wrap: (p) => p }
}

export interface KeysetPlan {
  terms: PostgresOrderTerm[]
  columns: KeysetColumn[]
  signature: string
}

const CURSOR_VERSION = 2
const MAX_CURSOR_LENGTH = 1024
const TERM_PATTERN = /^(.*) (ASC|DESC)( NULLS LAST)?$/s

function parseTerm(term: string): PostgresOrderTerm {
  const match = TERM_PATTERN.exec(term)
  if (match === null) throw new Error(`unparseable ORDER BY term: ${term}`)
  return { sql: match[1], direction: match[2] as 'ASC' | 'DESC', nullsLast: match[3] !== undefined }
}

export function buildPostgresVariantOrderTerms(
  sortBy: SortItem[] | undefined,
  sortColumns: Readonly<Record<string, string>>
): PostgresOrderTerm[] {
  const resolved: ResolvedVariantSort[] = []
  for (const sort of sortBy ?? []) {
    const column = sortColumns[sort.key]
    if (column !== undefined) resolved.push({ key: sort.key, column, order: sort.order })
  }
  // Natural chromosome order shared with the SQLite sink; direction is
  // normalised inside buildVariantOrderTerms (S7). `v.id` is the unique
  // tiebreaker (and the last column of idx_variants_case_chr_rank).
  const terms = buildVariantOrderTerms(resolved, 'v', 'postgres').map(parseTerm)
  if (!terms.some((term) => term.sql === 'v.id')) {
    terms.push({ sql: 'v.id', direction: 'ASC', nullsLast: false })
  }
  return terms
}

export function orderTermsToSql(terms: PostgresOrderTerm[]): string {
  return `ORDER BY ${terms
    .map((t) => `${t.sql} ${t.direction}${t.nullsLast ? ' NULLS LAST' : ''}`)
    .join(', ')}`
}

/** Null when the order cannot be expressed as an ascending row-value seek. */
export function planKeyset(terms: PostgresOrderTerm[]): KeysetPlan | null {
  const columns: KeysetColumn[] = []
  for (const term of terms) {
    const column = KEYSET_TERMS[term.sql]
    if (column === undefined || term.direction !== 'ASC') return null
    columns.push(column)
  }
  return { terms, columns, signature: terms.map((t) => t.sql).join(',') }
}

/** Binds a cursor to the order and the filter it was produced for. */
export function keysetScope(plan: KeysetPlan, filter: VariantFilter): string {
  return createHash('sha256')
    .update(plan.signature)
    .update('\0')
    .update(JSON.stringify(filter))
    .digest('base64url')
    .slice(0, 22)
}

export function encodeVariantCursor(
  plan: KeysetPlan,
  scope: string,
  row: Record<string, unknown>
): string | undefined {
  const values = plan.columns.map((column) => row[column.field])
  if (values.some((value) => value === null || value === undefined)) return undefined
  return Buffer.from(JSON.stringify({ v: CURSOR_VERSION, s: scope, k: values })).toString(
    'base64url'
  )
}

/** Returns the seek values, or null when the cursor is malformed or stale. */
export function decodeVariantCursor(
  plan: KeysetPlan,
  scope: string,
  cursor: string
): unknown[] | null {
  if (cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH) return null
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      v?: unknown
      s?: unknown
      k?: unknown
    }
    if (parsed.v !== CURSOR_VERSION || parsed.s !== scope || !Array.isArray(parsed.k)) return null
    if (parsed.k.length !== plan.columns.length) return null
    const valid = parsed.k.every((value, index) =>
      plan.columns[index].cast === 'bigint'
        ? (typeof value === 'number' && Number.isSafeInteger(value)) ||
          (typeof value === 'string' && /^-?\d{1,19}$/.test(value))
        : typeof value === 'string'
    )
    return valid ? parsed.k : null
  } catch {
    return null
  }
}

export function keysetPredicate(
  plan: KeysetPlan,
  values: unknown[],
  addParam: (value: unknown) => string
): string {
  const left = plan.terms.map((term) => term.sql).join(', ')
  const right = plan.columns
    .map((column, index) => column.wrap(`${addParam(values[index])}::${column.cast}`))
    .join(', ')
  return `(${left}) > (${right})`
}
