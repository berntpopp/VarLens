/**
 * Module-level annotation cache shared by every `useAnnotations()` caller.
 *
 * Owns the LRU cache, the per-variant loading flags, the stale-request
 * generation counter and the db/case scope tracking that clears stale data
 * when the user switches database or case.
 */

import { shallowRef, triggerRef } from 'vue'
import type {
  VariantAnnotation,
  CaseVariantAnnotation
} from '../../../shared/types/database-entities'
import { useDatabaseStore } from '../stores/databaseStore'
import { LruMap } from '../../../shared/utils/lru-map'

export interface AnnotationCache {
  global: VariantAnnotation | null
  perCase: CaseVariantAnnotation | null
}

export type AnnotationSlot = keyof AnnotationCache

export interface VariantCoords {
  chr: string
  pos: number
  ref: string
  alt: string
}

// Maximum number of annotation cache entries before LRU eviction
export const MAX_CACHE_SIZE = 5000

// Cache annotations by variant key (chr:pos:ref:alt)
// shallowRef avoids deep reactive proxies on 5000+ Map entries
// Exported so useVariantRowViewModel can read it for precomputed row state
const lruCache = new LruMap<string, AnnotationCache>(MAX_CACHE_SIZE)
export const annotationCache = shallowRef<LruMap<string, AnnotationCache>>(lruCache)

// Loading states per variant key
const loadingStates = shallowRef<Map<string, boolean>>(new Map())

/** Which table a batch load serves: the case table or the cohort (global) table. */
export type AnnotationBatchKind = 'case' | 'global'

// Generation counters — incremented on page/variant-set change so in-flight
// batch results from a prior page are discarded when they resolve. One per
// table: both tables can be alive at once (KeepAlive), and a page change in
// one must not drop the batch the other is still waiting for.
const annotationGenerations: Record<AnnotationBatchKind, number> = { case: 0, global: 0 }

// Scope tracking — detect db/case switches and auto-clear stale cache
let lastDbPath: string | null = null
let lastCaseId: number | null = null

/** Build variant key for cache lookup. */
export function variantKey({ chr, pos, ref, alt }: VariantCoords): string {
  return `${chr}:${pos}:${ref}:${alt}`
}

/**
 * LRU-aware cache setter. Delegates promotion and eviction to LruMap.
 *
 * Uses microtask batching: multiple cacheSet calls in the same tick produce
 * only one triggerRef flush, reducing reactivity churn during batch loads.
 */
let pendingCacheTrigger = false
export function cacheSet(key: string, value: AnnotationCache, unloaded?: AnnotationSlot): void {
  annotationCache.value.set(key, value)
  if (unloaded === undefined) unloadedSlots.delete(key)
  else rememberUnloadedSlot(key, unloaded)
  if (!pendingCacheTrigger) {
    pendingCacheTrigger = true
    Promise.resolve().then(() => {
      triggerRef(annotationCache)
      pendingCacheTrigger = false
    })
  }
}

/** Notify watchers after an in-place mutation of a cached entry. */
export function triggerAnnotationCache(): void {
  triggerRef(annotationCache)
}

// The cohort table (global scope) and the case table (per-case scope) share
// this cache. An entry is not always filled for both: a global load or write
// knows nothing about the per-case slot, and a per-case write on a row that
// was never loaded knows nothing about the global one. The slot that was never
// fetched holds `null` like a real "no annotation", so it is tracked here —
// otherwise the other table would take the entry as loaded and never ask.
// Entries without a mark (including ones set directly on the map) are complete.
const unloadedSlots = new Map<string, AnnotationSlot>()
// Keys whose in-flight request will only bring the global slot.
const globalOnlyLoading = new Set<string>()

function rememberUnloadedSlot(key: string, slot: AnnotationSlot): void {
  // Marks of entries the LRU evicted are dead weight; shed them now and then.
  if (unloadedSlots.size >= MAX_CACHE_SIZE * 2) {
    for (const stale of [...unloadedSlots.keys()]) {
      if (!annotationCache.value.has(stale)) unloadedSlots.delete(stale)
    }
  }
  unloadedSlots.set(key, slot)
}

/** The slot of a cached entry that was never fetched, if any. */
export function unloadedSlotOf(key: string): AnnotationSlot | undefined {
  return annotationCache.value.has(key) ? unloadedSlots.get(key) : undefined
}

/**
 * Store the result of a global load. It only knows the global slot, so a
 * per-case slot the cache already holds is kept.
 */
export function cacheSetGlobalSlot(key: string, global: VariantAnnotation | null): void {
  const cache = annotationCache.value
  const existing = cache.has(key) ? cache.get(key) : undefined
  const perCaseKnown = existing !== undefined && unloadedSlots.get(key) !== 'perCase'
  cacheSet(
    key,
    { global, perCase: existing?.perCase ?? null },
    perCaseKnown ? undefined : 'perCase'
  )
}

/** Set loading state and trigger shallowRef reactivity. */
export function setLoading(key: string, value: boolean, kind: AnnotationBatchKind = 'case'): void {
  loadingStates.value.set(key, value)
  if (value && kind === 'global') globalOnlyLoading.add(key)
  else globalOnlyLoading.delete(key)
  triggerRef(loadingStates)
}

export function isKeyLoading(key: string): boolean {
  return loadingStates.value.get(key) ?? false
}

/**
 * True when a load of `kind` has to fetch this key: it is neither in flight
 * nor cached with everything that kind of load provides. A per-case load
 * returns both slots; a global load only the global one.
 */
export function needsLoad(key: string, kind: AnnotationBatchKind): boolean {
  const inFlight = loadingStates.value.get(key) === true
  if (inFlight && (kind === 'global' || !globalOnlyLoading.has(key))) return false
  if (!annotationCache.value.has(key)) return true
  const unloaded = unloadedSlots.get(key)
  if (unloaded === undefined) return false
  return kind === 'case' || unloaded === 'global'
}

export function invalidateAnnotationGeneration(kind: AnnotationBatchKind): void {
  annotationGenerations[kind]++
}

export function getAnnotationGeneration(kind: AnnotationBatchKind): number {
  return annotationGenerations[kind]
}

// Keys a batch load skipped because an earlier batch already had them in
// flight. If that earlier batch turns out to be from a previous page it is
// discarded — except for these keys, which the current page is waiting for.
const awaitedKeys: Record<AnnotationBatchKind, Set<string>> = {
  case: new Set(),
  global: new Set()
}

/** Record that the current page of `kind` relies on an in-flight request for `key`. */
export function markAwaited(kind: AnnotationBatchKind, key: string): void {
  awaitedKeys[kind].add(key)
}

/** True (once) when the current page of `kind` is waiting for `key`. */
export function takeAwaited(kind: AnnotationBatchKind, key: string): boolean {
  return awaitedKeys[kind].delete(key)
}

// Incremented every time the cache is emptied. A request that captured an
// older epoch started against entries that no longer exist.
let cacheEpoch = 0

export function getAnnotationCacheEpoch(): number {
  return cacheEpoch
}

/** Drop every cached entry, loading flag and pending expectation, and notify. */
function clearEntries(): void {
  cacheEpoch++
  annotationCache.value.clear()
  loadingStates.value.clear()
  unloadedSlots.clear()
  globalOnlyLoading.clear()
  awaitedKeys.case.clear()
  awaitedKeys.global.clear()
  triggerRef(annotationCache)
  triggerRef(loadingStates)
}

/**
 * Get current database path safely (returns null if Pinia not available,
 * e.g. in unit tests without a store setup).
 */
function getCurrentDbPath(): string | null {
  try {
    const db = useDatabaseStore()
    return db.currentPath
  } catch {
    // Pinia not available (e.g. in unit tests without store setup)
    return null
  }
}

/**
 * Check if the scope (dbPath + caseId) has changed and clear cache if so.
 * Called before cache reads/writes to ensure stale data from a previous
 * database or case is never served.
 */
function ensureScopeOrClear(dbPath: string | null, caseId: number | null): void {
  const dbChanged = dbPath !== null && lastDbPath !== null && dbPath !== lastDbPath
  const caseChanged = caseId !== null && lastCaseId !== null && caseId !== lastCaseId

  if (dbChanged || caseChanged) clearEntries()

  if (dbPath !== null) lastDbPath = dbPath
  if (caseId !== null) lastCaseId = caseId
}

/**
 * Start a request for the given case (null = global scope): clears the cache
 * if the db/case changed and returns the database path the request belongs to.
 */
export function beginAnnotationRequest(caseId: number | null): string | null {
  const dbPath = getCurrentDbPath()
  ensureScopeOrClear(dbPath, caseId)
  return dbPath
}

/**
 * Empty the cache now if it still holds entries of a database that is no
 * longer open. A request does this on its way in; a response that finds the
 * database switched under it must do the same, or its optimistic value would
 * keep being served until the next request.
 */
export function dropCacheOfClosedDatabase(): void {
  ensureScopeOrClear(getCurrentDbPath(), null)
}

/** Guard against a database switch while a request was awaiting. */
export function hasDbSwitchedSince(requestDbPath: string | null): boolean {
  const currentDbPath = getCurrentDbPath()
  return currentDbPath !== null && requestDbPath !== null && currentDbPath !== requestDbPath
}

/** Guard against a case switch while a per-case request was awaiting. */
export function isTrackedCase(caseId: number): boolean {
  return lastCaseId === caseId
}

/** Clear cache and forget the tracked scope (call on case switch). */
export function clearAnnotationCache(): void {
  clearEntries()
  lastDbPath = null
  lastCaseId = null
}

/** Full reset including the generation counters — test isolation only. */
export function resetAnnotationState(): void {
  clearAnnotationCache()
  annotationGenerations.case = 0
  annotationGenerations.global = 0
}
