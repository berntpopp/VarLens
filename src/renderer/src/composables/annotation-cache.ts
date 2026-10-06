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

// Generation counter — incremented on page/variant-set change so in-flight
// batch results from a prior page are discarded when they resolve.
let annotationGeneration = 0

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
export function cacheSet(key: string, value: AnnotationCache): void {
  annotationCache.value.set(key, value)
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

/** Set loading state and trigger shallowRef reactivity. */
export function setLoading(key: string, value: boolean): void {
  loadingStates.value.set(key, value)
  triggerRef(loadingStates)
}

export function isKeyLoading(key: string): boolean {
  return loadingStates.value.get(key) ?? false
}

/** True when a load for this key would be redundant (cached or in flight). */
export function isCachedOrLoading(key: string): boolean {
  return annotationCache.value.has(key) || loadingStates.value.get(key) === true
}

export function invalidateAnnotationGeneration(): void {
  annotationGeneration++
}

export function getAnnotationGeneration(): number {
  return annotationGeneration
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

  if (dbChanged || caseChanged) {
    annotationCache.value.clear()
    loadingStates.value.clear()
    triggerRef(annotationCache)
    triggerRef(loadingStates)
  }

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
  annotationCache.value.clear()
  loadingStates.value.clear()
  triggerRef(annotationCache)
  triggerRef(loadingStates)
  lastDbPath = null
  lastCaseId = null
}

/** Full reset including the generation counter — test isolation only. */
export function resetAnnotationState(): void {
  clearAnnotationCache()
  annotationGeneration = 0
}
