/**
 * URL query codec for shareable / reloadable view state (pure, no Vue).
 *
 * Query keys (case view `/case`, cohort view `/cohort`):
 *   case  — selected case id (case view only)
 *   tab   — case variant-type tab: shortlist | snv | sv | cnv | str
 *   type  — cohort variant type: snv | sv | cnv | str
 *   f     — compact JSON of the filter state *diff* against FILTER_DEFAULTS,
 *           plus `i` (impact preset chips); search is not part of `f`
 *   q     — raw search / DSL text as typed in the search bar
 *   sort  — comma-separated sort keys, `-` prefix = descending ("gene,-pos")
 *
 * Only the keys are serialised; how a sort key is evaluated (e.g. natural
 * chromosome order) stays in the query layer. Decoders never trust the URL:
 * unknown keys are dropped and values are type-checked against the defaults.
 */
import { FILTER_DEFAULTS } from '../../../../shared/filters/filterDefaults'
import type { FilterState } from '../../../../shared/types/filters'
import type { VisibleTab } from '../../../../shared/types/shortlist'

export interface SortKey {
  key: string
  order: 'asc' | 'desc'
}

export interface FilterSnapshot {
  state: Partial<FilterState>
  impact: string[]
}

const SORT_KEY_PATTERN = /^[A-Za-z0-9_.]{1,64}$/
const MAX_SORT_KEYS = 5
const VISIBLE_TABS: readonly VisibleTab[] = ['shortlist', 'snv', 'sv', 'cnv', 'str']
/** Search is carried by `q` (raw bar text), never inside `f`. */
const EXCLUDED_FILTER_KEYS = new Set<string>(['searchQuery'])

export function encodeSort(items: readonly SortKey[]): string | undefined {
  const parts = items
    .filter((s) => SORT_KEY_PATTERN.test(s.key))
    .map((s) => (s.order === 'desc' ? `-${s.key}` : s.key))
  return parts.length > 0 ? parts.join(',') : undefined
}

export function decodeSort(raw: string | undefined | null): SortKey[] {
  if (raw === undefined || raw === null || raw === '') return []
  const out: SortKey[] = []
  for (const part of raw.split(',').slice(0, MAX_SORT_KEYS)) {
    const desc = part.startsWith('-')
    const key = desc ? part.slice(1) : part
    if (SORT_KEY_PATTERN.test(key)) out.push({ key, order: desc ? 'desc' : 'asc' })
  }
  return out
}

export function parsePositiveInt(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null || !/^\d{1,12}$/.test(raw)) return null
  const n = Number(raw)
  return n > 0 ? n : null
}

export function parseVisibleTab(raw: string | undefined | null): VisibleTab | null {
  return VISIBLE_TABS.includes(raw as VisibleTab) ? (raw as VisibleTab) : null
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** True when `value` has the same shape as the default for that filter key. */
function matchesDefaultShape(defaultValue: unknown, value: unknown): boolean {
  if (Array.isArray(defaultValue)) {
    return (
      Array.isArray(value) &&
      value.length <= 500 &&
      value.every((v) => typeof v === 'string' || typeof v === 'number')
    )
  }
  if (defaultValue === null) return value === null || typeof value === 'number'
  if (typeof defaultValue === 'object') {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }
  return typeof value === typeof defaultValue
}

export function encodeFilterSnapshot(
  state: FilterState,
  impact: readonly string[]
): string | undefined {
  const diff: Record<string, unknown> = {}
  for (const [key, defaultValue] of Object.entries(FILTER_DEFAULTS)) {
    if (EXCLUDED_FILTER_KEYS.has(key)) continue
    const value = (state as unknown as Record<string, unknown>)[key]
    if (value !== undefined && !sameJson(value, defaultValue)) diff[key] = value
  }
  if (impact.length > 0) diff.i = [...impact]
  return Object.keys(diff).length > 0 ? JSON.stringify(diff) : undefined
}

export function decodeFilterSnapshot(raw: string | undefined | null): FilterSnapshot {
  const empty: FilterSnapshot = { state: {}, impact: [] }
  if (raw === undefined || raw === null || raw === '' || raw.length > 8000) return empty
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return empty
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return empty
  const record = parsed as Record<string, unknown>
  const state: Record<string, unknown> = {}
  for (const [key, defaultValue] of Object.entries(FILTER_DEFAULTS)) {
    if (EXCLUDED_FILTER_KEYS.has(key) || !(key in record)) continue
    if (matchesDefaultShape(defaultValue, record[key])) state[key] = record[key]
  }
  const impact = Array.isArray(record.i)
    ? record.i.filter((v): v is string => typeof v === 'string').slice(0, 10)
    : []
  return { state: state as Partial<FilterState>, impact }
}
