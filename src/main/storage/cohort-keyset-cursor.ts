/**
 * Opaque cursors for cohort keyset paging (SQLite + PostgreSQL summary path).
 *
 * A cursor carries the raw COHORT_KEYSET_FIELDS values of a page's last row
 * and a scope hash binding it to the filter set that produced it. A cursor
 * that is malformed, stale (different filters) or used with a non-keyset sort
 * decodes to null and the caller serves the page with OFFSET instead — so a
 * client may always pass whatever cursor it holds.
 */
import { createHash } from 'node:crypto'

import { COHORT_KEYSET_FIELDS, isIntegerKeysetField } from '../../shared/sql/cohort-keyset'
import type { CohortSearchParams } from '../../shared/types/cohort'

const CURSOR_VERSION = 1
const MAX_CURSOR_LENGTH = 2048

/** Request keys that do not change which rows match or their order. */
const PAGING_KEYS: ReadonlySet<string> = new Set([
  'limit',
  'offset',
  'cursor',
  '_count_needed',
  'panel_intervals'
])

/** Stable hash of every filter/sort input of a cohort request. */
export function cohortKeysetScope(params: CohortSearchParams): string {
  const relevant = Object.keys(params)
    .filter((key) => !PAGING_KEYS.has(key))
    .sort()
    .map((key) => [key, (params as Record<string, unknown>)[key]])
  return createHash('sha256').update(JSON.stringify(relevant)).digest('base64url').slice(0, 22)
}

export function encodeCohortCursor(
  scope: string,
  row: Record<string, unknown>
): string | undefined {
  const values = COHORT_KEYSET_FIELDS.map((field) => row[field])
  if (values.some((value) => value === null || value === undefined)) return undefined
  const normalized = values.map((value) => (typeof value === 'bigint' ? Number(value) : value))
  return Buffer.from(JSON.stringify({ v: CURSOR_VERSION, s: scope, k: normalized })).toString(
    'base64url'
  )
}

function isValidValue(index: number, value: unknown): boolean {
  if (isIntegerKeysetField(COHORT_KEYSET_FIELDS[index])) {
    return typeof value === 'number' && Number.isSafeInteger(value)
  }
  return typeof value === 'string'
}

/** Seek values in COHORT_KEYSET_FIELDS order, or null (→ OFFSET fallback). */
export function decodeCohortCursor(scope: string, cursor: string | undefined): unknown[] | null {
  if (cursor === undefined || cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH) {
    return null
  }
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      v?: unknown
      s?: unknown
      k?: unknown
    }
    if (parsed.v !== CURSOR_VERSION || parsed.s !== scope || !Array.isArray(parsed.k)) return null
    if (parsed.k.length !== COHORT_KEYSET_FIELDS.length) return null
    return parsed.k.every((value, index) => isValidValue(index, value)) ? parsed.k : null
  } catch {
    return null
  }
}
