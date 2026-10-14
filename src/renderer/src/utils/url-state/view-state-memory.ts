/**
 * localStorage memory of a view's URL state (`f`, `q`, `sort`), keyed by
 * database identity + view scope (`case:<id>` or `cohort`). See #124.
 *
 * A stored snapshot is used only if every part still decodes to exactly what
 * was stored; anything else (old format, hand-edited, renamed filter) drops
 * the whole entry, so a view is never half-restored.
 */
import { VIEW_STATE_MEMORY } from '../../config/viewStateMemory'
import { createFilterState } from '../../../../shared/filters/filterDefaults'
import { logService } from '../../services/LogService'
import { formatError } from '../ipc-result'
import { decodeFilterSnapshot, decodeSort, encodeFilterSnapshot, encodeSort } from './view-query'

export const VIEW_STATE_KEYS = ['f', 'q', 'sort'] as const
export type ViewStateSnapshot = Partial<Record<(typeof VIEW_STATE_KEYS)[number], string>>

function isMemoryKey(key: string): key is (typeof VIEW_STATE_KEYS)[number] {
  return (VIEW_STATE_KEYS as readonly string[]).includes(key)
}

/** The snapshot if it is complete and round-trips through the URL codecs, else null. */
export function validViewSnapshot(value: unknown): ViewStateSnapshot | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const snapshot: ViewStateSnapshot = {}
  for (const [key, raw] of Object.entries(value)) {
    if (!isMemoryKey(key) || typeof raw !== 'string' || raw === '') return null
    snapshot[key] = raw
  }
  if (snapshot.f !== undefined) {
    const { state, impact } = decodeFilterSnapshot(snapshot.f)
    if (encodeFilterSnapshot(createFilterState(state), impact) !== snapshot.f) return null
  }
  if (snapshot.sort !== undefined && encodeSort(decodeSort(snapshot.sort)) !== snapshot.sort) {
    return null
  }
  return Object.keys(snapshot).length > 0 ? snapshot : null
}

function readAll(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(VIEW_STATE_MEMORY.storageKey) ?? '{}')
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function writeAll(all: Record<string, unknown>): void {
  try {
    localStorage.setItem(VIEW_STATE_MEMORY.storageKey, JSON.stringify(all))
  } catch (e) {
    logService.warn('Saving view state failed: ' + formatError(e), 'view-state-memory')
  }
}

/** Stored view for `key`; an invalid entry is deleted and reported as none. */
export function loadViewState(key: string): ViewStateSnapshot | null {
  const all = readAll()
  if (!(key in all)) return null
  const snapshot = validViewSnapshot(all[key])
  if (snapshot === null) {
    delete all[key]
    writeAll(all)
  }
  return snapshot
}

/** Remember `snapshot` for `key` (most recent last); an empty snapshot forgets it. */
export function saveViewState(key: string, snapshot: ViewStateSnapshot): void {
  const all = readAll()
  delete all[key]
  if (Object.keys(snapshot).length > 0) all[key] = snapshot
  const keys = Object.keys(all)
  for (const old of keys.slice(0, Math.max(0, keys.length - VIEW_STATE_MEMORY.maxEntries))) {
    delete all[old]
  }
  writeAll(all)
}
