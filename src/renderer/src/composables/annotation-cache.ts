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

export * from './annotation-mutation-tracker'
import {
  clearMutationTracker,
  getPerCaseSlotOwner,
  perCaseSlotKey,
  perCaseVersionSlot,
  perCaseByVariantId,
  type SlotValue,
  type SlotPatch,
  perCaseSlotOwners,
  confirmedBases,
  inFlightMutations,
  confirmedFieldPatches,
  setConfirmedFieldPatch,
  ensurePerCaseSlotOwner,
  bumpWriteVersion,
  getConfirmedWriteVersion,
  setConfirmedWriteVersion,
  pruneInFlightMutationsOnSuccess,
  deletePerCaseForCoordKey
} from './annotation-mutation-tracker'

export type AnnotationSlot = keyof AnnotationCache

export function otherSlot(slot: AnnotationSlot): AnnotationSlot {
  return slot === 'perCase' ? 'global' : 'perCase'
}

export function readSlot(
  entry: AnnotationCache,
  slot: AnnotationSlot | { kind: 'case' | 'global' }
): SlotValue | null {
  return (typeof slot === 'string' ? slot : slotOf(slot)) === 'perCase'
    ? entry.perCase
    : entry.global
}

export function writeSlot(
  entry: AnnotationCache,
  slot: AnnotationSlot | { kind: 'case' | 'global' },
  value: SlotValue | null
): void {
  if ((typeof slot === 'string' ? slot : slotOf(slot)) === 'perCase') {
    entry.perCase = value as CaseVariantAnnotation | null
  } else {
    entry.global = value as VariantAnnotation | null
  }
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
  return scope.kind === 'case'
    ? { global: current?.global ?? null, perCase: updated as CaseVariantAnnotation }
    : { global: updated as VariantAnnotation, perCase: current?.perCase ?? null }
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
const lruCache = new LruMap<string, AnnotationCache>(MAX_CACHE_SIZE, (key) => dropKeyState(key))
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
  } else if (unloaded === 'perCase') {
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

export function cacheSetGlobalSlot(key: string, global: VariantAnnotation | null): void {
  const existing = annotationCache.value.get(key)
  const perCaseKnown = existing !== undefined && unloadedSlots.get(key) !== 'perCase'
  cacheSet(
    key,
    { global, perCase: existing?.perCase ?? null },
    perCaseKnown ? undefined : 'perCase'
  )
}

export function cacheSetPerCaseSlot(
  key: string,
  perCase: CaseVariantAnnotation | null,
  requestedVariantId?: number
): void {
  const existing = annotationCache.value.get(key)
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

export const invalidateAnnotationGeneration = (kind: AnnotationBatchKind): void =>
  void annotationGenerations[kind]++
export const getAnnotationGeneration = (kind: AnnotationBatchKind): number =>
  annotationGenerations[kind]

const awaitedKeys: Record<AnnotationBatchKind, Set<string>> = { case: new Set(), global: new Set() }
export const markAwaited = (kind: AnnotationBatchKind, key: string): void =>
  void awaitedKeys[kind].add(key)
export const takeAwaited = (kind: AnnotationBatchKind, key: string): boolean =>
  awaitedKeys[kind].delete(key)

let cacheEpoch = 0
export const getAnnotationCacheEpoch = (): number => cacheEpoch
export const getGeneration = (): number => cacheEpoch

let evictionEpoch = 0
const keyVersions = new Map<string, number>()
export const getKeyVersion = (key: string): number =>
  evictionEpoch * 1_000_000 + (keyVersions.get(key) ?? 0)
export const bumpKeyVersion = (key: string): void => {
  keyVersions.set(key, (keyVersions.get(key) ?? 0) + 1)
}

export function getPerCaseByVariantId(
  caseId: number,
  variantId: number,
  coordKey?: string
): CaseVariantAnnotation | null | undefined {
  if (typeof coordKey === 'string' && coordKey.length > 0) {
    const cached = annotationCache.value.get(coordKey)?.perCase
    if (cached != null && cached.case_id === caseId && cached.variant_id === variantId) {
      return cached
    }
  }
  return perCaseByVariantId.get(`${caseId}:${variantId}`)
}

/** Drop every cached entry, loading flag and pending expectation, and notify. */
function clearEntries(): void {
  cacheEpoch++
  evictionEpoch++
  for (const m of [keyVersions, cachedVariantIds, loadingTokens, unloadedSlots]) m.clear()
  clearMutationTracker()
  annotationCache.value.clear()
  loadingStates.value.clear()
  globalOnlyLoading.clear()
  awaitedKeys.case.clear()
  awaitedKeys.global.clear()
  triggerRef(annotationCache)
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

export const getCachedBuild = (): string | null => lastBuild
export const getCachedCaseId = (): number | null => lastCaseId
export const dropCacheOfClosedDatabase = (): void => ensureScopeOrClear(getCurrentDbPath(), null)
export const hasDbSwitchedSince = (requestDbPath: string | null): boolean => {
  const currentDbPath = getCurrentDbPath()
  return currentDbPath !== null && requestDbPath !== null && currentDbPath !== requestDbPath
}
export const isTrackedCase = (caseId: number): boolean => lastCaseId === caseId

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

function dropKeyState(key: string): void {
  dropKeyMetadata(key)
  deletePerCaseForCoordKey(key)
  const o = getPerCaseSlotOwner(key)
  if (o) {
    const sk = perCaseSlotKey(o.caseId, o.variantId, key)
    confirmedBases.delete(sk)
    inFlightMutations.delete(sk)
    confirmedFieldPatches.delete(sk)
  }
  perCaseSlotOwners.delete(key)
  for (const p of ['perCase', 'global']) {
    confirmedBases.delete(`${p}:${key}`)
    inFlightMutations.delete(`${p}:${key}`)
    confirmedFieldPatches.delete(`${p}:${key}`)
  }
}

/** Evict specific variant keys from the cache while preserving unrelated entries. */
export function evictAnnotationCacheKeys(keys: Iterable<string>): void {
  let changed = false
  for (const key of keys) {
    if (annotationCache.value.delete(key)) changed = true
    dropKeyState(key)
  }
  if (changed) triggerRef(annotationCache)
}

function applyBulkUpdatesPatch(
  slotKey: string,
  fg: 'star' | 'acmg' | 'comment',
  u: Record<string, unknown>
): void {
  if (fg === 'star' && ('starred' in u || 'is_starred' in u)) {
    const isStarred = Boolean(u.starred ?? u.is_starred)
    setConfirmedFieldPatch(slotKey, 'star', { starred: isStarred ? 1 : 0 })
  } else if (fg === 'acmg' && ('acmg_classification' in u || 'acmg_evidence' in u)) {
    const patch: SlotPatch = { ...(confirmedFieldPatches.get(slotKey)?.acmg ?? {}) }
    if ('acmg_classification' in u) {
      patch.acmg_classification =
        (u.acmg_classification as SlotPatch['acmg_classification']) ?? null
    }
    if ('acmg_evidence' in u) {
      patch.acmg_evidence = (u.acmg_evidence as string | null) ?? null
    }
    setConfirmedFieldPatch(slotKey, 'acmg', patch)
  } else if (fg === 'comment' && 'per_case_comment' in u) {
    setConfirmedFieldPatch(slotKey, 'comment', {
      per_case_comment: (u.per_case_comment as string | null) ?? null
    })
  }
}

/** Evict keys for bulk triage while preserving newer and untouched single-row mutations. */
export function evictAnnotationCacheKeysForBulkTriage(
  affectedKeys: Iterable<string>,
  touchedFields: Array<'star' | 'acmg' | 'comment'>,
  bulkWriteVersions: Map<string, Map<string, number>>,
  bulkUpdates?: Record<string, unknown> | object,
  bulkOwners?: Map<
    string,
    { caseId: number; variantId: number } | Array<{ caseId: number; variantId: number }>
  >
): void {
  let changed = false
  const updates = bulkUpdates as Record<string, unknown> | undefined
  for (const key of affectedKeys) {
    if (annotationCache.value.delete(key)) changed = true
    dropKeyMetadata(key)
    deletePerCaseForCoordKey(key)
    const rawOwners = bulkOwners?.get(key) ?? getPerCaseSlotOwner(key)
    const owners: Array<{ caseId: number; variantId: number }> = Array.isArray(rawOwners)
      ? rawOwners
      : rawOwners
        ? [rawOwners]
        : []
    if (owners.length > 0) {
      const primary = owners[owners.length - 1]
      ensurePerCaseSlotOwner(key, primary.caseId, primary.variantId)
    }
    const targetOwners: Array<{ caseId: number; variantId: number } | undefined> =
      owners.length > 0 ? owners : [undefined]
    for (const fg of touchedFields) {
      for (const o of targetOwners) {
        const slotKey = o ? perCaseSlotKey(o.caseId, o.variantId, key) : `perCase:${key}`
        const vSlot = o ? perCaseVersionSlot(o.caseId, o.variantId, fg) : `perCase:${fg}`
        const verMap = bulkWriteVersions.get(key)
        const bulkVer = verMap?.get(vSlot) ?? verMap?.get(fg) ?? bumpWriteVersion(key, vSlot)
        const prevConfirmed = getConfirmedWriteVersion(key, vSlot)
        if (bulkVer > prevConfirmed) {
          setConfirmedWriteVersion(key, vSlot, bulkVer)
          if (!o) setConfirmedWriteVersion(key, `perCase:${fg}`, bulkVer)
          pruneInFlightMutationsOnSuccess(slotKey, fg, bulkVer)
          if (!o) pruneInFlightMutationsOnSuccess(`perCase:${key}`, fg, bulkVer)
          if (
            updates &&
            (inFlightMutations.has(slotKey) || inFlightMutations.has(`perCase:${key}`))
          ) {
            applyBulkUpdatesPatch(slotKey, fg, updates)
            if (slotKey !== `perCase:${key}`) applyBulkUpdatesPatch(`perCase:${key}`, fg, updates)
          } else {
            for (const sk of [slotKey, `perCase:${key}`]) {
              const patches = confirmedFieldPatches.get(sk)
              if (patches) {
                delete patches[fg]
                if (Object.keys(patches).length === 0) confirmedFieldPatches.delete(sk)
              }
            }
          }
        }
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
  clearMutationTracker()
  cacheEpoch = 0
  evictionEpoch = 0
  nextLoadingToken = 0
  for (const m of [keyVersions, cachedVariantIds, loadingTokens]) m.clear()
  annotationGenerations.case = 0
  annotationGenerations.global = 0
}
