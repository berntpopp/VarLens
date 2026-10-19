/**
 * Scope-parameterised annotation operations.
 * Binds load and optimistic mutations to per-case and global scopes.
 */

import { logService } from '../services/LogService'
import { BUILD_COPY, GENOME_BUILDS } from '../../../shared/config/genome-builds.config'
import type { WindowAPI, BatchAnnotationKey } from '../../../shared/types/api'
import type { CaseVariantAnnotation } from '../../../shared/types/database-entities'
import type { AcmgClassification } from '../../../shared/config/domain.config'
import { isIpcError, unwrapIpcResult } from '../../../shared/types/errors'
// prettier-ignore
import {
  allocateMutationId, annotationCache, applyConfirmedFieldPatches, beginAnnotationRequest,
  bumpKeyVersion, bumpWriteVersion, cacheSet, cacheSetGlobalSlot, cacheSetPerCaseSlot,
  computeOptimisticSlot, confirmedBases, confirmedFieldPatches, dropCacheOfClosedDatabase,
  ensurePerCaseSlotOwner, evictAnnotationCacheKeys, evictPerCaseVariant, getAnnotationCacheEpoch,
  getAnnotationGeneration, getCachedVariantId, getConfirmedWriteVersion, getKeyVersion,
  getPerCaseSlotOwner, hasDbSwitchedSince, hasPerCaseByVariantId, inFlightMutations, isCacheOfBuild,
  isKeyLoading, isPerCaseSlotOwner, isTrackedCase, markAwaited, mergeServerSlot, needsLoad, otherSlot,
  perCaseSlotKey, perCaseVersionSlot, pruneInFlightMutationsOnSuccess, readSlot, removeInFlightMutation,
  rollBackSlot, setCachedVariantId, setConfirmedFieldPatch, setConfirmedWriteVersion, setLoading,
  setPerCaseByVariantId, perCaseByVariantId, getPerCaseByVariantId, slotIdentity, slotOf, takeAwaited,
  triggerAnnotationCache, unloadedSlotOf, variantKey, writeSlot,
  type AnnotationCache, type AnnotationUpdates, type AnnotationWriteScope, type MutationPlan,
  type SlotValue, type VariantCoords,
  extractFieldGroupPatch, toggleStarPlan, acmgPlan, commentPlan, acmgWithEvidencePlan
} from './annotation-cache'

/** Scope of a load: one case, or global. */
export type AnnotationLoadScope =
  { kind: 'case'; caseId: number; build: string | null } | { kind: 'global'; build: string | null }

export function globalScope(build: string | null): { kind: 'global'; build: string | null } {
  return { kind: 'global', build }
}
const globalBuildOf = (scope: AnnotationLoadScope): string | null | undefined =>
  scope.kind === 'global' ? scope.build : undefined

/** A global write for a case whose build the user still has to confirm. */
class UnconfirmedBuildError extends Error {}

const getTransportErrorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : isIpcError(e) ? (e.userMessage ?? e.message) : String(e)

const scopeCaseId = (scope: AnnotationLoadScope): number | null =>
  scope.kind === 'case' ? scope.caseId : null

const scopeQualifier = (scope: AnnotationLoadScope): string =>
  scope.kind === 'global' ? 'global ' : ''

/** Discard a response when the database (or, per case, the case) switched while awaiting. */
function isResponseStale(scope: AnnotationLoadScope, requestDbPath: string | null): boolean {
  if (hasDbSwitchedSince(requestDbPath)) return true
  if (!isCacheOfBuild(scope.build)) return true
  return scope.kind === 'case' && !isTrackedCase(scope.caseId)
}

/** True when a write settled after its database or case was left. */
function leftScope(scope: AnnotationWriteScope, requestDbPath: string | null): boolean {
  if (!isResponseStale(scope, requestDbPath)) return false
  dropCacheOfClosedDatabase()
  return true
}

function upsert(
  client: WindowAPI,
  scope: AnnotationWriteScope,
  { chr, pos, ref, alt }: VariantCoords,
  updates: AnnotationUpdates
) {
  if (scope.kind === 'case')
    return client.annotations.upsertPerCase(scope.caseId, scope.variantId, updates)
  if (scope.build === null) throw new Error('genome build unknown; global annotation not saved')
  if (!GENOME_BUILDS.some((b) => b.id === scope.build)) {
    throw new UnconfirmedBuildError(BUILD_COPY.globalNotesNeedBuild)
  }
  return client.annotations.upsertGlobal(chr, pos, ref, alt, updates, scope.build)
}

/**
 * Optimistically apply a write, confirm it over IPC, roll back on failure.
 * Resolves `false` when nothing was saved, after telling the user (#486).
 */
async function mutate(
  api: WindowAPI | undefined,
  onWriteFailed: (message?: string) => void,
  scope: AnnotationWriteScope,
  coords: VariantCoords,
  fieldGroup: 'star' | 'acmg' | 'comment',
  buildPlan: (cur: SlotValue | null, base: SlotValue | null) => MutationPlan
): Promise<boolean> {
  if (!api) return false
  const dbPath = beginAnnotationRequest(scopeCaseId(scope), scope.build)
  const epoch = getAnnotationCacheEpoch()
  const key = variantKey(coords)
  const hadPerCase = scope.kind === 'case' && hasPerCaseByVariantId(scope.caseId, scope.variantId)
  const rowPerCase =
    scope.kind === 'case' ? getPerCaseByVariantId(scope.caseId, scope.variantId, key) : undefined
  const rawCurrent = annotationCache.value.get(key)
  const pc = rawCurrent?.perCase
  const cachedVid = getCachedVariantId(key)
  const slotOwner = getPerCaseSlotOwner(key)
  // prettier-ignore
  const siblingOccupied =
    scope.kind === 'case' &&
    ((pc != null && (pc.variant_id !== scope.variantId || pc.case_id !== scope.caseId)) ||
      (pc === null &&
        ((cachedVid !== undefined && cachedVid !== scope.variantId) ||
          (slotOwner !== undefined && (slotOwner.variantId !== scope.variantId || slotOwner.caseId !== scope.caseId)))))
  const current = siblingOccupied ? undefined : rawCurrent
  // prettier-ignore
  const curSlot = (scope.kind === 'case' && rowPerCase !== undefined ? rowPerCase : current ? readSlot(current, scope) : null) ?? null
  const slot = slotOf(scope)
  const slotKey =
    scope.kind === 'case' ? perCaseSlotKey(scope.caseId, scope.variantId, key) : `global:${key}`
  const vSlot =
    scope.kind === 'case'
      ? perCaseVersionSlot(scope.caseId, scope.variantId, fieldGroup)
      : `global:${fieldGroup}`
  if (scope.kind === 'case') ensurePerCaseSlotOwner(key, scope.caseId, scope.variantId)
  const baseSlot = confirmedBases.get(slotKey) ?? curSlot
  const plan = buildPlan(curSlot, baseSlot)

  const writeVer = bumpWriteVersion(key, vSlot)
  const mutationId = allocateMutationId()

  const list = inFlightMutations.get(slotKey) ?? []
  list.push({
    id: mutationId,
    fieldGroup,
    writeVer,
    patch: { ...plan.optimistic, ...slotIdentity(scope) }
  })
  inFlightMutations.set(slotKey, list)

  const optimistic = computeOptimisticSlot(
    confirmedBases.get(slotKey) ?? (baseSlot ? { ...baseSlot } : null),
    list
  )
  if (!confirmedBases.has(slotKey)) {
    confirmedBases.set(slotKey, baseSlot ? { ...baseSlot } : null)
  }
  if (current) {
    writeSlot(current, scope, optimistic)
    triggerAnnotationCache()
  }
  // prettier-ignore
  if (scope.kind === 'case') {
    setPerCaseByVariantId(scope.caseId, scope.variantId, optimistic as CaseVariantAnnotation | null, key)
  }

  try {
    const updated = unwrapIpcResult<SlotValue>(await upsert(api, scope, coords, plan.updates))
    const confirmedVer = getConfirmedWriteVersion(key, vSlot)
    if (
      leftScope(scope, dbPath) ||
      (scope.kind === 'case' && epoch !== getAnnotationCacheEpoch()) ||
      writeVer <= confirmedVer
    ) {
      if (epoch === getAnnotationCacheEpoch()) {
        removeInFlightMutation(slotKey, mutationId)
      }
      return true
    }
    setConfirmedWriteVersion(key, vSlot, writeVer)
    const patch = extractFieldGroupPatch(scope, fieldGroup, updated)
    setConfirmedFieldPatch(slotKey, fieldGroup, patch)
    const isOwner = scope.kind === 'case' && isPerCaseSlotOwner(key, scope.caseId, scope.variantId)
    if (isOwner) setConfirmedFieldPatch(`perCase:${key}`, fieldGroup, patch)
    pruneInFlightMutationsOnSuccess(slotKey, fieldGroup, writeVer)

    const remaining = inFlightMutations.get(slotKey)
    const mergedConfirmed = applyConfirmedFieldPatches(slotKey, updated)!
    const finalSlot =
      remaining && remaining.length > 0
        ? computeOptimisticSlot(mergedConfirmed, remaining)
        : mergedConfirmed
    if (scope.kind === 'case') {
      setPerCaseByVariantId(scope.caseId, scope.variantId, finalSlot as CaseVariantAnnotation, key)
    }
    if (!remaining || remaining.length === 0) {
      confirmedBases.delete(slotKey)
      inFlightMutations.delete(slotKey)
      confirmedFieldPatches.delete(slotKey)
      if (isOwner) confirmedFieldPatches.delete(`perCase:${key}`)
    } else {
      confirmedBases.set(slotKey, mergedConfirmed)
    }

    if (scope.kind === 'case' && !isOwner) {
      return true
    }

    const live = annotationCache.value.get(key)
    if (epoch !== getAnnotationCacheEpoch() && !live) return true
    const written = slot
    const unloaded = live ? unloadedSlotOf(key) : otherSlot(written)
    bumpKeyVersion(key)
    cacheSet(
      key,
      mergeServerSlot(live, scope, finalSlot!),
      unloaded === written ? undefined : unloaded
    )
    return true
  } catch (error) {
    const isOwner = scope.kind !== 'case' || isPerCaseSlotOwner(key, scope.caseId, scope.variantId)
    const hadMutation =
      epoch === getAnnotationCacheEpoch() &&
      (inFlightMutations.get(slotKey)?.some((m) => m.id === mutationId) ?? false)
    if (epoch === getAnnotationCacheEpoch()) {
      removeInFlightMutation(slotKey, mutationId)
    }
    logService.error(plan.failureMessage + getTransportErrorMessage(error), 'annotations')
    onWriteFailed(error instanceof UnconfirmedBuildError ? error.message : undefined)
    if (leftScope(scope, dbPath)) return false

    if (hadMutation) {
      if (confirmedBases.has(slotKey)) {
        const remaining = inFlightMutations.get(slotKey)
        const rawBase = confirmedBases.get(slotKey) ?? null
        const base = applyConfirmedFieldPatches(slotKey, rawBase)
        const nextSlot =
          remaining && remaining.length > 0
            ? computeOptimisticSlot(base, remaining)
            : base
              ? { ...base }
              : null
        if (!remaining || remaining.length === 0) {
          confirmedBases.delete(slotKey)
          inFlightMutations.delete(slotKey)
          confirmedFieldPatches.delete(slotKey)
          if (isOwner) confirmedFieldPatches.delete(`perCase:${key}`)
        }
        // prettier-ignore
        if (scope.kind === 'case') {
          if ((!remaining || remaining.length === 0) && !hadPerCase && nextSlot === null) {
            perCaseByVariantId.delete(`${scope.caseId}:${scope.variantId}`)
          } else {
            setPerCaseByVariantId(scope.caseId, scope.variantId, nextSlot as CaseVariantAnnotation | null, key)
          }
        }
        if (isOwner) {
          const target =
            (epoch === getAnnotationCacheEpoch() ? annotationCache.value.get(key) : undefined) ??
            current
          if (target) {
            const canWriteTarget =
              (scope.kind !== 'case' ||
                current !== undefined ||
                target.perCase == null ||
                target.perCase.variant_id === scope.variantId) &&
              !(current === undefined && rawBase === null && (!remaining || remaining.length === 0))
            if (canWriteTarget) {
              if (nextSlot !== null) writeSlot(target, scope, nextSlot)
              else rollBackSlot(target, scope, plan.rollback, null)
            }
          }
        }
      } else if (current !== undefined) {
        // prettier-ignore
        if (scope.kind === 'case') {
          setPerCaseByVariantId(scope.caseId, scope.variantId, baseSlot as CaseVariantAnnotation | null, key)
        }
        if (isOwner) {
          const target =
            (epoch === getAnnotationCacheEpoch() ? annotationCache.value.get(key) : undefined) ??
            current
          rollBackSlot(target, scope, plan.rollback, baseSlot)
        }
      }
    }
    triggerAnnotationCache()
    return false
  }
}

async function fetchEntry(
  client: WindowAPI,
  scope: AnnotationLoadScope,
  { chr, pos, ref, alt }: VariantCoords
): Promise<AnnotationCache> {
  if (scope.kind === 'case') {
    return unwrapIpcResult(await client.annotations.getForVariant(scope.caseId, chr, pos, ref, alt))
  }
  if (scope.build === null) return { global: null, perCase: null }
  const global = unwrapIpcResult(
    await client.annotations.getGlobal(chr, pos, ref, alt, scope.build)
  )
  return { global, perCase: null }
}

/** Cache a load result: a per-case load fills both slots, a global load only its own. */
function storeLoaded(key: string, scope: AnnotationLoadScope, entry: AnnotationCache): void {
  if (scope.kind === 'case') {
    const owner = entry.perCase
      ? { caseId: entry.perCase.case_id, variantId: entry.perCase.variant_id }
      : getPerCaseSlotOwner(key)
    const slotKey = owner ? perCaseSlotKey(owner.caseId, owner.variantId, key) : `perCase:${key}`
    const inFlight = inFlightMutations.get(slotKey)
    if (entry.perCase !== null) {
      ensurePerCaseSlotOwner(key, entry.perCase.case_id, entry.perCase.variant_id)
      setPerCaseByVariantId(entry.perCase.case_id, entry.perCase.variant_id, entry.perCase, key)
      if (inFlight && inFlight.length > 0) {
        const writeScope: AnnotationWriteScope = {
          kind: 'case',
          caseId: entry.perCase.case_id,
          variantId: entry.perCase.variant_id,
          build: scope.build
        }
        for (const fg of ['star', 'acmg', 'comment'] as const) {
          if (confirmedFieldPatches.get(slotKey)?.[fg] === undefined) {
            const p = extractFieldGroupPatch(writeScope, fg, entry.perCase)
            setConfirmedFieldPatch(slotKey, fg, p)
            setConfirmedFieldPatch(`perCase:${key}`, fg, p)
          }
        }
      }
    }
    if (inFlight && inFlight.length > 0) {
      const basePerCase = entry.perCase
        ? (applyConfirmedFieldPatches(slotKey, entry.perCase) as CaseVariantAnnotation)
        : null
      confirmedBases.set(slotKey, basePerCase)
      const perCase = computeOptimisticSlot(basePerCase, inFlight) as CaseVariantAnnotation | null
      cacheSet(key, { global: entry.global, perCase })
      if (owner) setPerCaseByVariantId(owner.caseId, owner.variantId, perCase, key)
    } else {
      confirmedBases.delete(slotKey)
      inFlightMutations.delete(slotKey)
      confirmedFieldPatches.delete(slotKey)
      const hasOther = Array.from(inFlightMutations.keys()).some(
        (k) => k.endsWith(`:${key}`) && k !== slotKey
      )
      if (!hasOther) confirmedFieldPatches.delete(`perCase:${key}`)
      cacheSet(key, { global: entry.global, perCase: entry.perCase })
    }
  } else {
    cacheSetGlobalSlot(key, entry.global)
  }
}

function applyStalePerCaseSlot(
  key: string,
  entry: AnnotationCache,
  caseId: number,
  reqVid?: number
): void {
  const unloaded = unloadedSlotOf(key)
  if (unloaded === 'global') cacheSetGlobalSlot(key, entry.global)
  else if (unloaded === 'perCase') {
    const pc = entry.perCase
    if (
      reqVid === undefined ||
      pc === null ||
      (pc.variant_id === reqVid && pc.case_id === caseId)
    ) {
      cacheSetPerCaseSlot(key, pc, reqVid)
      if (reqVid !== undefined) {
        setPerCaseByVariantId(caseId, reqVid, pc, key)
      } else if (pc !== null) {
        setPerCaseByVariantId(caseId, pc.variant_id, pc, key)
      }
    }
  }
}

/** Load annotations for one variant (call on row visible or expand). */
async function load(
  api: WindowAPI | undefined,
  scope: AnnotationLoadScope,
  coords: VariantCoords
): Promise<void> {
  // A global row is only known for a build: without one there is nothing to load.
  if (!api || globalBuildOf(scope) === null) return
  const dbPath = beginAnnotationRequest(scopeCaseId(scope), scope.build)
  const key = variantKey(coords)
  if (!needsLoad(key, scope.kind)) return

  const version = getKeyVersion(key)
  const loadingToken = setLoading(key, true, scope.kind)
  try {
    const entry = await fetchEntry(api, scope, coords)
    if (isResponseStale(scope, dbPath)) return
    const isStale =
      scope.kind === 'case'
        ? getKeyVersion(key) !== version
        : getKeyVersion(key) % 1_000_000 !== version % 1_000_000
    if (isStale) {
      const sameEpoch =
        Math.floor(getKeyVersion(key) / 1_000_000) === Math.floor(version / 1_000_000)
      if (scope.kind === 'case' && sameEpoch) applyStalePerCaseSlot(key, entry, scope.caseId)
      return
    }
    storeLoaded(key, scope, entry)
    if (scope.kind === 'case' && entry.perCase) {
      setPerCaseByVariantId(scope.caseId, entry.perCase.variant_id, entry.perCase, key)
    }
  } catch (error) {
    logService.error(
      `Failed to load ${scopeQualifier(scope)}annotations: ` + getTransportErrorMessage(error),
      'annotations'
    )
  } finally {
    if (scope.kind !== 'case' || isTrackedCase(scope.caseId)) {
      setLoading(key, false, scope.kind, loadingToken)
    }
  }
}

/** A row to batch-load: per-case rows also carry their `variants.id`. */
export type BatchLoadVariant = VariantCoords & { id?: number; is_starred?: boolean }

/** The key sent to `annotations:batchGet`. Per-case keys must carry `variantId`. */
function batchKey(scope: AnnotationLoadScope, v: BatchLoadVariant): BatchAnnotationKey {
  const key: BatchAnnotationKey = { chr: v.chr, pos: v.pos, ref: v.ref, alt: v.alt }
  if (scope.kind === 'case' && typeof v.id === 'number') key.variantId = v.id
  return key
}

/** Bulk load annotations for visible variants. */
async function loadBatch(
  api: WindowAPI | undefined,
  scope: AnnotationLoadScope,
  variants: BatchLoadVariant[]
): Promise<void> {
  if (!api || globalBuildOf(scope) === null) return
  const dbPath = beginAnnotationRequest(scopeCaseId(scope), scope.build)
  // Captured at call time — used to detect results from a prior page.
  const generation = getAnnotationGeneration(scope.kind)

  // Filter out cached AND in-flight keys to prevent duplicate IPC calls
  const seenVariantIdentifiers = new Set<string>()
  const neededVariants: BatchLoadVariant[] = []
  for (const v of variants) {
    const key = variantKey(v)
    const ident = scope.kind === 'case' && typeof v.id === 'number' ? `${key}:${v.id}` : key
    if (seenVariantIdentifiers.has(ident)) continue
    seenVariantIdentifiers.add(ident)
    let sameCoords = true
    if (scope.kind === 'case') {
      const cached = annotationCache.value.get(key)
      const cachedVid = getCachedVariantId(key)
      sameCoords = cached?.global?.chr === undefined || cached.global.chr === v.chr
      if (
        typeof v.id === 'number' &&
        cached !== undefined &&
        sameCoords &&
        unloadedSlotOf(key) !== 'perCase' &&
        ((cached.perCase === null && (cachedVid === undefined || cachedVid === v.id)) ||
          cached.perCase?.variant_id === v.id)
      ) {
        setPerCaseByVariantId(scope.caseId, v.id, cached.perCase, key)
      }
      const targetVid = typeof v.id === 'number' ? v.id : cachedVid
      const vSlotKey =
        targetVid !== undefined ? perCaseSlotKey(scope.caseId, targetVid, key) : `perCase:${key}`
      const hasInFlight = inFlightMutations.has(vSlotKey) || inFlightMutations.has(`perCase:${key}`)
      let starStale = false
      // prettier-ignore
      if (typeof v.is_starred === 'boolean' && !hasInFlight) {
        if (typeof v.id === 'number' && hasPerCaseByVariantId(scope.caseId, v.id)) {
          starStale = (getPerCaseByVariantId(scope.caseId, v.id)?.starred === 1) !== v.is_starred
        } else if (cached !== undefined && (v.id === undefined || cached.perCase?.variant_id === v.id || (cached.perCase === null && cachedVid === v.id))) {
          starStale = (cached.perCase?.starred === 1) !== v.is_starred
        }
      }
      const coordStale = v.id === undefined && cached?.perCase != null
      const stale = sameCoords && (starStale || coordStale)
      if (stale) {
        if (typeof v.id === 'number') evictPerCaseVariant(scope.caseId, v.id, key)
        else evictAnnotationCacheKeys([key])
      }
    }
    const needCaseVid =
      scope.kind === 'case' &&
      typeof v.id === 'number' &&
      sameCoords &&
      !hasPerCaseByVariantId(scope.caseId, v.id) &&
      !isKeyLoading(key)
    if (needsLoad(key, scope.kind) || needCaseVid) {
      neededVariants.push(v)
    } else if (isKeyLoading(key)) {
      markAwaited(scope.kind, key)
    }
  }
  if (neededVariants.length === 0) return

  // Partition into waves where each coordinate key appears at most once per wave
  const waves: BatchAnnotationKey[][] = []
  for (const v of neededVariants) {
    const bk = batchKey(scope, v)
    const k = variantKey(bk)
    let targetWave = waves.find((w) => !w.some((item) => variantKey(item) === k))
    if (!targetWave) waves.push((targetWave = []))
    targetWave.push(bk)
  }

  for (const uncached of waves) {
    const requestedVariantIds = new Map<string, number>()
    const keyVersionsAtStart = new Map<string, number>()
    const loadingTokensAtStart = new Map<string, number>()
    for (const vk of uncached) {
      const k = variantKey(vk)
      if (typeof vk.variantId === 'number') requestedVariantIds.set(k, vk.variantId)
      keyVersionsAtStart.set(k, getKeyVersion(k))
      loadingTokensAtStart.set(k, setLoading(k, true, scope.kind))
    }

    try {
      const results = unwrapIpcResult(
        await api.annotations.batchGet(scopeCaseId(scope), uncached, globalBuildOf(scope) ?? null)
      )
      if (isResponseStale(scope, dbPath)) return
      const fromPriorPage = generation !== getAnnotationGeneration(scope.kind)
      for (const [key, value] of Object.entries(results)) {
        const startVer = keyVersionsAtStart.get(key)
        if (startVer !== undefined) {
          const isStale =
            scope.kind === 'case'
              ? getKeyVersion(key) !== startVer
              : getKeyVersion(key) % 1_000_000 !== startVer % 1_000_000
          if (isStale) {
            const sameEpoch =
              Math.floor(getKeyVersion(key) / 1_000_000) === Math.floor(startVer / 1_000_000)
            if (scope.kind === 'case' && sameEpoch) {
              const awaited = takeAwaited(scope.kind, key)
              if (!fromPriorPage || awaited) {
                applyStalePerCaseSlot(
                  key,
                  value as AnnotationCache,
                  scope.caseId,
                  requestedVariantIds.get(key)
                )
              }
            }
            continue
          }
        }
        const awaited = takeAwaited(scope.kind, key)
        if (fromPriorPage && !awaited) continue
        if (scope.kind === 'case' && requestedVariantIds.has(key)) {
          ensurePerCaseSlotOwner(key, scope.caseId, requestedVariantIds.get(key)!)
        }
        storeLoaded(key, scope, value as AnnotationCache)
        if (scope.kind === 'case' && requestedVariantIds.has(key)) {
          const loaded = (value as AnnotationCache)?.perCase ?? null
          const reqVid = requestedVariantIds.get(key)!
          if (
            loaded === null ||
            (loaded.variant_id === reqVid && loaded.case_id === scope.caseId)
          ) {
            setCachedVariantId(key, reqVid)
          }
          const stored = isPerCaseSlotOwner(key, scope.caseId, reqVid)
            ? (annotationCache.value.get(key)?.perCase ?? loaded)
            : loaded
          setPerCaseByVariantId(scope.caseId, reqVid, stored, key)
        }
      }
    } catch (error) {
      logService.warn(
        `Failed to load ${scopeQualifier(scope)}annotation batch: ` +
          getTransportErrorMessage(error),
        'annotations'
      )
    } finally {
      if (scope.kind !== 'case' || isTrackedCase(scope.caseId)) {
        for (const vk of uncached) {
          const k = variantKey(vk)
          setLoading(k, false, scope.kind, loadingTokensAtStart.get(k))
        }
      }
    }
  }
}

// prettier-ignore
export function createScopedAnnotationOps(
  api: WindowAPI | undefined,
  getUserName: () => string | undefined,
  onWriteFailed: (message?: string) => void = () => {}
) {
  return {
    load: (scope: AnnotationLoadScope, coords: VariantCoords) => load(api, scope, coords),
    loadBatch: (scope: AnnotationLoadScope, variants: BatchLoadVariant[]) => loadBatch(api, scope, variants),
    toggleStar: (s: AnnotationWriteScope, c: VariantCoords) =>
      mutate(api, onWriteFailed, s, c, 'star', (cur, base) => toggleStarPlan(s, cur, base)),
    setAcmgClassification: (s: AnnotationWriteScope, c: VariantCoords, cl: AcmgClassification | null) =>
      mutate(api, onWriteFailed, s, c, 'acmg', (_c, base) => acmgPlan(s, base, cl)),
    upsertComment: (s: AnnotationWriteScope, c: VariantCoords, comment: string | null) =>
      mutate(api, onWriteFailed, s, c, 'comment', (_c, base) => commentPlan(s, base, comment)),
    setAcmgClassificationWithEvidence: (s: AnnotationWriteScope, c: VariantCoords, cl: AcmgClassification | null, ev: string) =>
      mutate(api, onWriteFailed, s, c, 'acmg', () => acmgWithEvidencePlan(s, cl, ev, getUserName()))
  }
}
