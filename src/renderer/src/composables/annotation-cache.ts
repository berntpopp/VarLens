/**
 * Module-level annotation cache shared by every `useAnnotations()` caller.
 * Owns the LRU cache, loading flags, generation counters and db/case/build scope tracking.
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
export type SlotValue = VariantAnnotation | CaseVariantAnnotation
export type SlotPatch = Partial<VariantAnnotation> & Partial<CaseVariantAnnotation>

export function otherSlot(slot: AnnotationSlot): AnnotationSlot {
  return slot === 'perCase' ? 'global' : 'perCase'
}

export function readSlot(
  entry: AnnotationCache,
  slot: AnnotationSlot | { kind: 'case' | 'global' }
): SlotValue | null {
  const s = typeof slot === 'string' ? slot : slot.kind === 'case' ? 'perCase' : 'global'
  return s === 'perCase' ? entry.perCase : entry.global
}

export function writeSlot(
  entry: AnnotationCache,
  slot: AnnotationSlot | { kind: 'case' | 'global' },
  value: SlotValue | null
): void {
  const s = typeof slot === 'string' ? slot : slot.kind === 'case' ? 'perCase' : 'global'
  if (s === 'perCase') entry.perCase = value as CaseVariantAnnotation | null
  else entry.global = value as VariantAnnotation | null
}

export function slotOf(scope: { kind: 'case' | 'global' }): AnnotationSlot {
  return scope.kind === 'case' ? 'perCase' : 'global'
}

export function slotIdentity(
  scope: { kind: 'case'; caseId: number; variantId: number } | { kind: 'global' }
): SlotPatch {
  return scope.kind === 'case' ? { case_id: scope.caseId, variant_id: scope.variantId } : {}
}

export function mergeServerSlot(
  current: AnnotationCache | undefined,
  scope: { kind: 'case' | 'global' },
  updated: SlotValue
): AnnotationCache {
  if (scope.kind === 'case') {
    return { global: current?.global ?? null, perCase: updated as CaseVariantAnnotation }
  }
  return { global: updated as VariantAnnotation, perCase: current?.perCase ?? null }
}

export function rollBackSlot(
  current: AnnotationCache,
  scope: { kind: 'case' | 'global' },
  rollback: SlotPatch | 'restore-previous',
  base: SlotValue | null
): void {
  const value =
    rollback === 'restore-previous'
      ? base
      : ({ ...readSlot(current, scope), ...rollback } as SlotValue)
  writeSlot(current, scope, value)
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

// Tracks variant_id mapped to cache key, including for entries whose perCase slot is null
const cachedVariantIds = new Map<string, number>()

export function getCachedVariantId(key: string): number | undefined {
  return annotationCache.value.get(key)?.perCase?.variant_id ?? cachedVariantIds.get(key)
}

export function setCachedVariantId(key: string, variantId: number): void {
  cachedVariantIds.set(key, variantId)
}

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
let lastBuild: string | null = null

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
  if (value.perCase && typeof value.perCase.variant_id === 'number') {
    cachedVariantIds.set(key, value.perCase.variant_id)
  } else {
    cachedVariantIds.delete(key)
  }
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

// Tracks un-fetched slots so views know whether an entry is complete.
const unloadedSlots = new Map<string, AnnotationSlot>()
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

/**
 * Store the result of a per-case load. It only knows the per-case slot, so a
 * global slot the cache already holds is kept.
 */
export function cacheSetPerCaseSlot(
  key: string,
  perCase: CaseVariantAnnotation | null,
  requestedVariantId?: number
): void {
  const cache = annotationCache.value
  const existing = cache.has(key) ? cache.get(key) : undefined
  const globalKnown = existing !== undefined && unloadedSlots.get(key) !== 'global'
  cacheSet(key, { global: existing?.global ?? null, perCase }, globalKnown ? undefined : 'global')
  if (
    requestedVariantId !== undefined &&
    (perCase === null || perCase.variant_id === requestedVariantId)
  ) {
    cachedVariantIds.set(key, requestedVariantId)
  }
}

let nextLoadingToken = 0
const loadingTokens = new Map<string, number>()

/** Set loading state and trigger shallowRef reactivity. Returns loading token if set true. */
export function setLoading(
  key: string,
  value: boolean,
  kind: AnnotationBatchKind = 'case',
  token?: number
): number {
  if (value) {
    const next = ++nextLoadingToken
    loadingStates.value.set(key, true)
    loadingTokens.set(key, next)
    if (kind === 'global') globalOnlyLoading.add(key)
    else globalOnlyLoading.delete(key)
    triggerRef(loadingStates)
    return next
  }
  if (token !== undefined && loadingTokens.get(key) !== token) {
    return 0
  }
  loadingStates.value.delete(key)
  loadingTokens.delete(key)
  globalOnlyLoading.delete(key)
  triggerRef(loadingStates)
  return 0
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

// Keys a batch load skipped because an earlier batch already had them in flight.
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

// Incremented every time the cache is emptied.
let cacheEpoch = 0

export function getAnnotationCacheEpoch(): number {
  return cacheEpoch
}

export function getGeneration(): number {
  return cacheEpoch
}

// Version counter per variant key — incremented on eviction to drop stale reads.
let evictionEpoch = 0
const keyVersions = new Map<string, number>()

export function getKeyVersion(key: string): number {
  return evictionEpoch * 1_000_000 + (keyVersions.get(key) ?? 0)
}

export function bumpKeyVersion(key: string): void {
  keyVersions.set(key, (keyVersions.get(key) ?? 0) + 1)
}

const issuedWriteVersions = new Map<string, number>()
const confirmedWriteVersions = new Map<string, number>()
const confirmedFieldPatches = new Map<
  string,
  Partial<Record<'star' | 'acmg' | 'comment', SlotPatch>>
>()

export function bumpWriteVersion(key: string, slot: string = 'perCase'): number {
  const k = `${slot}:${key}`
  const next = (issuedWriteVersions.get(k) ?? 0) + 1
  issuedWriteVersions.set(k, next)
  return next
}

export function getWriteVersion(key: string, slot: string = 'perCase'): number {
  return issuedWriteVersions.get(`${slot}:${key}`) ?? 0
}

export function getConfirmedWriteVersion(key: string, slot: string = 'perCase'): number {
  return confirmedWriteVersions.get(`${slot}:${key}`) ?? 0
}

export function setConfirmedWriteVersion(key: string, slot: string, version: number): void {
  const k = `${slot}:${key}`
  if (version > (confirmedWriteVersions.get(k) ?? 0)) {
    confirmedWriteVersions.set(k, version)
  }
}

export function setConfirmedFieldPatch(
  slotKey: string,
  fieldGroup: 'star' | 'acmg' | 'comment',
  patch: SlotPatch
): void {
  if (Object.keys(patch).length === 0) return
  const existing = confirmedFieldPatches.get(slotKey) ?? {}
  existing[fieldGroup] = patch
  confirmedFieldPatches.set(slotKey, existing)
}

export function applyConfirmedFieldPatches(
  slotKey: string,
  base: SlotValue | null
): SlotValue | null {
  if (base === null) return null
  const patches = confirmedFieldPatches.get(slotKey)
  if (!patches) return base
  let merged: Record<string, unknown> = { ...base }
  for (const fg of ['star', 'acmg', 'comment'] as const) {
    if (patches[fg]) merged = { ...merged, ...patches[fg] }
  }
  return merged as unknown as SlotValue
}

export interface InFlightMutation {
  id: number
  fieldGroup: 'star' | 'acmg' | 'comment'
  writeVer: number
  patch: Record<string, unknown>
}

export const confirmedBases = new Map<string, VariantAnnotation | CaseVariantAnnotation | null>()
export const inFlightMutations = new Map<string, InFlightMutation[]>()

export function computeOptimisticSlot(
  base: VariantAnnotation | CaseVariantAnnotation | null,
  mutations: InFlightMutation[]
): VariantAnnotation | CaseVariantAnnotation | null {
  if (base === null && mutations.length === 0) return null
  let result: Record<string, unknown> = base ? { ...base } : {}
  for (const m of mutations) {
    result = { ...result, ...m.patch }
  }
  return result as unknown as VariantAnnotation | CaseVariantAnnotation
}

export function removeInFlightMutation(slotKey: string, mutationId: number): void {
  const list = inFlightMutations.get(slotKey)
  if (!list) return
  const filtered = list.filter((m) => m.id !== mutationId)
  if (filtered.length === 0) {
    inFlightMutations.delete(slotKey)
  } else {
    inFlightMutations.set(slotKey, filtered)
  }
}

export function pruneInFlightMutationsOnSuccess(
  slotKey: string,
  fieldGroup: string,
  writeVer: number
): void {
  const list = inFlightMutations.get(slotKey)
  if (!list) return
  const filtered = list.filter((m) => !(m.fieldGroup === fieldGroup && m.writeVer <= writeVer))
  if (filtered.length === 0) {
    inFlightMutations.delete(slotKey)
  } else {
    inFlightMutations.set(slotKey, filtered)
  }
}

/** Drop every cached entry, loading flag and pending expectation, and notify. */
function clearEntries(): void {
  cacheEpoch++
  evictionEpoch++
  keyVersions.clear()
  cachedVariantIds.clear()
  confirmedBases.clear()
  inFlightMutations.clear()
  confirmedWriteVersions.clear()
  confirmedFieldPatches.clear()
  annotationCache.value.clear()
  loadingStates.value.clear()
  loadingTokens.clear()
  unloadedSlots.clear()
  globalOnlyLoading.clear()
  awaitedKeys.case.clear()
  awaitedKeys.global.clear()
  triggerRef(annotationCache)
  triggerRef(loadingStates)
}

/** Get current database path safely (returns null if Pinia not available). */
export function getCurrentDbPath(): string | null {
  try {
    const db = useDatabaseStore()
    return db.currentPath
  } catch {
    return null
  }
}

/** Check if the scope (dbPath + caseId + build) has changed and clear cache if so. */
function ensureScopeOrClear(
  dbPath: string | null,
  caseId: number | null,
  build: string | null = null
): void {
  const dbChanged = dbPath !== null && lastDbPath !== null && dbPath !== lastDbPath
  const caseChanged = caseId !== null && lastCaseId !== null && caseId !== lastCaseId
  const buildChanged = build !== null && lastBuild !== null && build !== lastBuild
  const buildUnknown = caseId !== null && build === null && lastBuild !== null

  if (dbChanged || caseChanged || buildChanged || buildUnknown) {
    clearEntries()
    if (caseId === null) lastCaseId = null
  }

  if (dbPath !== null) lastDbPath = dbPath
  if (caseId !== null) lastCaseId = caseId
  if (build !== null || buildUnknown) lastBuild = build
}

/** Start a request: clears the cache if scope changed and returns db path. */
export function beginAnnotationRequest(
  caseId: number | null,
  build: string | null = null
): string | null {
  const dbPath = getCurrentDbPath()
  ensureScopeOrClear(dbPath, caseId, build)
  return dbPath
}

/** False while the cache holds another build's entries. */
export function isCacheOfBuild(build: string | null): boolean {
  return build === null || lastBuild === null || lastBuild === build
}

/** Currently tracked genome build of the cached annotations. */
export function getCachedBuild(): string | null {
  return lastBuild
}

/** Currently tracked case ID of the cached annotations. */
export function getCachedCaseId(): number | null {
  return lastCaseId
}

/** Empty the cache if it still holds entries of a closed database. */
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

function dropKeyMetadata(key: string): void {
  keyVersions.set(key, (keyVersions.get(key) ?? 0) + 1)
  cachedVariantIds.delete(key)
  loadingStates.value.delete(key)
  loadingTokens.delete(key)
  unloadedSlots.delete(key)
  globalOnlyLoading.delete(key)
  awaitedKeys.case.delete(key)
  awaitedKeys.global.delete(key)
}

/** Evict specific variant keys from the cache while preserving unrelated entries. */
export function evictAnnotationCacheKeys(keys: Iterable<string>): void {
  let changed = false
  for (const key of keys) {
    if (annotationCache.value.delete(key)) changed = true
    dropKeyMetadata(key)
    confirmedBases.delete(`perCase:${key}`)
    confirmedBases.delete(`global:${key}`)
    inFlightMutations.delete(`perCase:${key}`)
    inFlightMutations.delete(`global:${key}`)
    confirmedFieldPatches.delete(`perCase:${key}`)
    confirmedFieldPatches.delete(`global:${key}`)
  }
  if (changed) triggerRef(annotationCache)
}

/** Evict keys for bulk triage while preserving newer and untouched single-row mutations. */
export function evictAnnotationCacheKeysForBulkTriage(
  affectedKeys: Iterable<string>,
  touchedFields: Array<'star' | 'acmg' | 'comment'>,
  bulkWriteVersions: Map<string, Map<'star' | 'acmg' | 'comment', number>>
): void {
  let changed = false
  for (const key of affectedKeys) {
    if (annotationCache.value.delete(key)) changed = true
    dropKeyMetadata(key)
    const slotKey = `perCase:${key}`
    for (const fg of touchedFields) {
      const bulkVer = bulkWriteVersions.get(key)?.get(fg) ?? bumpWriteVersion(key, `perCase:${fg}`)
      setConfirmedWriteVersion(key, `perCase:${fg}`, bulkVer)
      pruneInFlightMutationsOnSuccess(slotKey, fg, bulkVer)
      const patches = confirmedFieldPatches.get(slotKey)
      if (patches) {
        delete patches[fg]
        if (Object.keys(patches).length === 0) confirmedFieldPatches.delete(slotKey)
      }
    }
  }
  if (changed) triggerRef(annotationCache)
}

/** Clear cache and forget the tracked scope (call on case switch). */
export function clearAnnotationCache(): void {
  clearEntries()
  lastDbPath = null
  lastCaseId = null
  lastBuild = null
}

/** Full reset including the generation counters — test isolation only. */
export function resetAnnotationState(): void {
  clearAnnotationCache()
  cacheEpoch = 0
  evictionEpoch = 0
  nextLoadingToken = 0
  keyVersions.clear()
  issuedWriteVersions.clear()
  confirmedWriteVersions.clear()
  confirmedFieldPatches.clear()
  cachedVariantIds.clear()
  confirmedBases.clear()
  inFlightMutations.clear()
  loadingTokens.clear()
  annotationGenerations.case = 0
  annotationGenerations.global = 0
}
