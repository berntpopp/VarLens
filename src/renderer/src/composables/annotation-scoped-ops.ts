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
  allocateLoadSeq, allocateMutationId, annotationCache, applyConfirmedFieldPatches, beginAnnotationRequest,
  bumpCaseVariantVersion, bumpKeyVersion, bumpWriteVersion, cacheSet, cacheSetGlobalSlot,
  cacheSetPerCaseSlot, cleanupUnloadedPerCaseVariant, computeOptimisticSlot, confirmedBases, confirmedFieldPatches,
  dropCacheOfClosedDatabase, ensurePerCaseSlotOwner, evictAnnotationCacheKeys, evictPerCaseVariant,
  evictCoordSlotOnly, getAnnotationCacheEpoch, getAnnotationGeneration, getCachedBuild, getCachedVariantId,
  getCaseVariantVersion, getConfirmedWriteVersion, getKeyVersion, getLoadingVariantId, getPerCaseSlotOwner,
  hasDbSwitchedSince, hasInFlightMutationsForCoord, hasLoadedPerCaseByVariantId, hasPerCaseByVariantId,
  inFlightMutations, isCacheOfBuild, isKeyLoading, isLoadSeqStale, isLoadingCaseVariant, isPerCaseSlotOwner,
  isTrackedCase, markAwaited, markLoadSeqAccepted, mergeServerSlot, needsLoad, otherSlot, perCaseSlotKey,
  perCaseSlotOwners, perCaseVersionSlot, pruneInFlightMutationsOnSuccess, readSlot, removeInFlightMutation,
  retireWriteVersionsForCoord, rollBackSlot, setCachedVariantId, setConfirmedFieldPatch,
  setConfirmedWriteVersion, setLoading, setLoadingCaseVariant, setLoadingVariantId, setPerCaseByVariantId,
  getPerCaseByVariantId, shouldKeepVariantLoadGuard, slotIdentity, slotOf, takeAwaited,
  triggerAnnotationCache, unloadedSlotOf, variantKey, writeSlot,
  type AnnotationCache, type AnnotationUpdates, type AnnotationWriteScope, type MutationPlan,
  type SlotValue, type ToggleStarOptions, type VariantCoords,
  extractFieldGroupPatch, toggleStarPlan, acmgPlan, commentPlan, acmgWithEvidencePlan
} from './annotation-cache'

/** Scope of a load: one case, or global. */
export type AnnotationLoadScope =
  | { kind: 'case'; caseId: number; variantId?: number; build: string | null }
  | { kind: 'global'; build: string | null }

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

// prettier-ignore
const isResponseStale = (scope: AnnotationLoadScope, requestDbPath: string | null): boolean =>
  hasDbSwitchedSince(requestDbPath) || !isCacheOfBuild(scope.build) || (scope.kind === 'case' && !isTrackedCase(scope.caseId))

// prettier-ignore
const leftScope = (scope: AnnotationWriteScope, requestDbPath: string | null): boolean => {
  if (!isResponseStale(scope, requestDbPath)) return false
  dropCacheOfClosedDatabase(); return true
}

// prettier-ignore
function upsert(client: WindowAPI, scope: AnnotationWriteScope, { chr, pos, ref, alt }: VariantCoords, updates: AnnotationUpdates) {
  if (scope.kind === 'case') return client.annotations.upsertPerCase(scope.caseId, scope.variantId, updates)
  if (scope.build === null) throw new Error('genome build unknown; global annotation not saved')
  if (!GENOME_BUILDS.some((b) => b.id === scope.build)) throw new UnconfirmedBuildError(BUILD_COPY.globalNotesNeedBuild)
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
  const startBuild = getCachedBuild()
  const epoch = getAnnotationCacheEpoch()
  const key = variantKey(coords)
  // prettier-ignore
  const rowPerCase = scope.kind === 'case' ? getPerCaseByVariantId(scope.caseId, scope.variantId, key) : undefined
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
  // prettier-ignore
  const slotKey = scope.kind === 'case' ? perCaseSlotKey(scope.caseId, scope.variantId, key) : `global:${key}`
  // prettier-ignore
  const vSlot = scope.kind === 'case' ? perCaseVersionSlot(scope.caseId, scope.variantId, fieldGroup) : `global:${fieldGroup}`
  if (scope.kind === 'case' && !siblingOccupied) {
    ensurePerCaseSlotOwner(key, scope.caseId, scope.variantId)
  }
  const baseSlot = confirmedBases.has(slotKey) ? (confirmedBases.get(slotKey) ?? null) : curSlot
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

  const optimistic = computeOptimisticSlot(baseSlot ? { ...baseSlot } : null, list)
  if (!confirmedBases.has(slotKey)) {
    confirmedBases.set(slotKey, baseSlot ? { ...baseSlot } : null)
  }
  if (current) {
    writeSlot(current, scope, optimistic)
    triggerAnnotationCache()
  }
  // prettier-ignore
  if (scope.kind === 'case') {
    setPerCaseByVariantId(scope.caseId, scope.variantId, optimistic as CaseVariantAnnotation | null, key, false)
    if (siblingOccupied) triggerAnnotationCache()
  }

  try {
    const updated = unwrapIpcResult<SlotValue>(await upsert(api, scope, coords, plan.updates))
    const confirmedVer = getConfirmedWriteVersion(key, vSlot)
    const buildSwitched = scope.build === null && getCachedBuild() !== startBuild
    // prettier-ignore
    if (leftScope(scope, dbPath) || buildSwitched || plan.isStillActive?.() === false || (scope.kind === 'case' && epoch !== getAnnotationCacheEpoch()) || writeVer <= confirmedVer) {
      if (epoch === getAnnotationCacheEpoch()) {
        removeInFlightMutation(slotKey, mutationId)
        const rem = inFlightMutations.get(slotKey)
        if (!rem || rem.length === 0) {
          confirmedBases.delete(slotKey)
          if (scope.kind === 'case' && !hasLoadedPerCaseByVariantId(scope.caseId, scope.variantId)) {
            cleanupUnloadedPerCaseVariant(key, scope.caseId, scope.variantId, (cid, vid) => shouldKeepVariantLoadGuard(key, cid, vid), confirmedVer === 0)
            if (!annotationCache.value.has(key) && !hasInFlightMutationsForCoord(key)) perCaseSlotOwners.delete(key)
          }
        }
      }
      return true
    }
    setConfirmedWriteVersion(key, vSlot, writeVer)
    const patch = extractFieldGroupPatch(scope, fieldGroup, updated)
    setConfirmedFieldPatch(slotKey, fieldGroup, patch)
    const isOwner = scope.kind === 'case' && isPerCaseSlotOwner(key, scope.caseId, scope.variantId)
    if (isOwner) {
      setConfirmedFieldPatch(`perCase:${key}`, fieldGroup, patch)
      pruneInFlightMutationsOnSuccess(`perCase:${key}`, fieldGroup, writeVer)
    }
    pruneInFlightMutationsOnSuccess(slotKey, fieldGroup, writeVer)

    const remaining = inFlightMutations.get(slotKey)
    const priorBase = confirmedBases.get(slotKey)
    const mergedUpdated = (priorBase ? { ...priorBase, ...updated } : updated) as SlotValue
    const mergedConfirmed = applyConfirmedFieldPatches(slotKey, mergedUpdated)!
    // prettier-ignore
    const finalSlot = remaining && remaining.length > 0 ? computeOptimisticSlot(mergedConfirmed, remaining) : mergedConfirmed

    if (scope.kind === 'case') {
      bumpCaseVariantVersion(scope.caseId, scope.variantId)
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
      triggerAnnotationCache()
      return true
    }

    const live = annotationCache.value.get(key)
    if (epoch !== getAnnotationCacheEpoch() && !live) return true
    const written = slot
    const unloaded = live ? unloadedSlotOf(key) : otherSlot(written)
    bumpKeyVersion(key)
    // prettier-ignore
    cacheSet(key, mergeServerSlot(live, scope, finalSlot!), unloaded === written ? undefined : unloaded)
    return true
  } catch (error) {
    const isOwner = scope.kind !== 'case' || isPerCaseSlotOwner(key, scope.caseId, scope.variantId)
    // prettier-ignore
    const hadMutation = epoch === getAnnotationCacheEpoch() && (inFlightMutations.get(slotKey)?.some((m) => m.id === mutationId) ?? false)
    if (epoch === getAnnotationCacheEpoch()) {
      removeInFlightMutation(slotKey, mutationId)
    }
    logService.error(plan.failureMessage + getTransportErrorMessage(error), plan.logSource ?? 'annotations')
    onWriteFailed(error instanceof UnconfirmedBuildError ? error.message : undefined)
    if (leftScope(scope, dbPath)) return false

    if (hadMutation) {
      const liveTarget = epoch === getAnnotationCacheEpoch() ? annotationCache.value.get(key) : undefined
      const target = liveTarget ?? current
      // prettier-ignore
      const liveHoldsVariant = scope.kind === 'case' && liveTarget !== undefined &&
        ((liveTarget.perCase != null && liveTarget.perCase.variant_id === scope.variantId && liveTarget.perCase.case_id === scope.caseId) ||
          (liveTarget.perCase == null && getCachedVariantId(key) === scope.variantId))
      // prettier-ignore
      const targetHoldsVariant = scope.kind !== 'case' || isOwner || liveHoldsVariant ||
        (target?.perCase != null && target.perCase.variant_id === scope.variantId && target.perCase.case_id === scope.caseId) ||
        (target?.perCase == null && getCachedVariantId(key) === scope.variantId)
      if (confirmedBases.has(slotKey)) {
        const remaining = inFlightMutations.get(slotKey)
        const rawBase = confirmedBases.get(slotKey) ?? null
        const base = applyConfirmedFieldPatches(slotKey, rawBase)
        // prettier-ignore
        const nextSlot = remaining && remaining.length > 0 ? computeOptimisticSlot(base, remaining) : base ? { ...base } : null
        if (!remaining || remaining.length === 0) {
          confirmedBases.delete(slotKey); inFlightMutations.delete(slotKey); confirmedFieldPatches.delete(slotKey)
          if (isOwner) confirmedFieldPatches.delete(`perCase:${key}`)
        }
        // prettier-ignore
        if (scope.kind === 'case') {
          const hasLoaded = hasLoadedPerCaseByVariantId(scope.caseId, scope.variantId)
          if ((!remaining || remaining.length === 0) && !hasLoaded && (nextSlot === null || (current !== undefined && !liveTarget))) {
            cleanupUnloadedPerCaseVariant(key, scope.caseId, scope.variantId, (cid, vid) => shouldKeepVariantLoadGuard(key, cid, vid))
            if (!liveTarget && !hasInFlightMutationsForCoord(key)) perCaseSlotOwners.delete(key)
          } else {
            bumpCaseVariantVersion(scope.caseId, scope.variantId)
            setPerCaseByVariantId(scope.caseId, scope.variantId, nextSlot as CaseVariantAnnotation | null, key, hasLoaded)
          }
        } else if ((!remaining || remaining.length === 0) && !liveTarget && !hasInFlightMutationsForCoord(key)) {
          retireWriteVersionsForCoord(key)
        }
        if (target && targetHoldsVariant) {
          // prettier-ignore
          const canWriteTarget = scope.kind !== 'case' || (current !== undefined
            ? (target.perCase == null && (getCachedVariantId(key) === undefined || getCachedVariantId(key) === scope.variantId)) ||
              (target.perCase != null && target.perCase.variant_id === scope.variantId && target.perCase.case_id === scope.caseId)
            : target.perCase != null && target.perCase.variant_id === scope.variantId && target.perCase.case_id === scope.caseId &&
              !(rawBase === null && (!remaining || remaining.length === 0)))
          if (canWriteTarget) {
            if (nextSlot !== null) writeSlot(target, scope, nextSlot)
            else rollBackSlot(target, scope, plan.rollback, null)
          }
        }
      } else if (current !== undefined) {
        // prettier-ignore
        if (scope.kind === 'case') {
          const hasLoaded = hasLoadedPerCaseByVariantId(scope.caseId, scope.variantId)
          if (!hasLoaded && !liveHoldsVariant) {
            cleanupUnloadedPerCaseVariant(key, scope.caseId, scope.variantId, (cid, vid) => shouldKeepVariantLoadGuard(key, cid, vid))
            if (!liveTarget && !hasInFlightMutationsForCoord(key)) perCaseSlotOwners.delete(key)
          } else {
            bumpCaseVariantVersion(scope.caseId, scope.variantId)
            setPerCaseByVariantId(scope.caseId, scope.variantId, baseSlot as CaseVariantAnnotation | null, key, hasLoaded)
          }
        } else if (!liveTarget && !hasInFlightMutationsForCoord(key)) {
          retireWriteVersionsForCoord(key)
        }
        if (target && targetHoldsVariant) {
          rollBackSlot(target, scope, plan.rollback, baseSlot)
        }
      }
    }
    triggerAnnotationCache()
    return false
  }
}

// prettier-ignore
async function fetchEntry(client: WindowAPI, scope: AnnotationLoadScope, { chr, pos, ref, alt }: VariantCoords): Promise<AnnotationCache> {
  if (scope.kind === 'case') {
    if (typeof scope.variantId === 'number' && typeof client.annotations.batchGet === 'function') {
      const batchRes = await client.annotations.batchGet(scope.caseId, [{ chr, pos, ref, alt, variantId: scope.variantId }], null)
      if (batchRes !== undefined) {
        const map = unwrapIpcResult(batchRes)
        const k = variantKey({ chr, pos, ref, alt })
        if (k in map) return map[k] as AnnotationCache
      }
    }
    return unwrapIpcResult(await client.annotations.getForVariant(scope.caseId, chr, pos, ref, alt))
  }
  if (scope.build === null) return { global: null, perCase: null }
  const global = unwrapIpcResult(await client.annotations.getGlobal(chr, pos, ref, alt, scope.build))
  return { global, perCase: null }
}

// prettier-ignore
function storeLoaded(key: string, scope: AnnotationLoadScope, entry: AnnotationCache): void {
  if (scope.kind === 'case') {
    const owner = entry.perCase
      ? { caseId: entry.perCase.case_id, variantId: entry.perCase.variant_id }
      : scope.variantId !== undefined
        ? { caseId: scope.caseId, variantId: scope.variantId }
        : getPerCaseSlotOwner(key)
    const slotKey = owner ? perCaseSlotKey(owner.caseId, owner.variantId, key) : `perCase:${key}`
    const inFlight = inFlightMutations.get(slotKey)
    if (entry.perCase !== null) {
      ensurePerCaseSlotOwner(key, entry.perCase.case_id, entry.perCase.variant_id)
      setPerCaseByVariantId(entry.perCase.case_id, entry.perCase.variant_id, entry.perCase, key)
    }
    if (inFlight && inFlight.length > 0) {
      const basePerCase = applyConfirmedFieldPatches(slotKey, entry.perCase) as CaseVariantAnnotation | null
      confirmedBases.set(slotKey, basePerCase)
      const perCase = computeOptimisticSlot(basePerCase, inFlight) as CaseVariantAnnotation | null
      cacheSet(key, { global: entry.global, perCase })
      if (owner) setPerCaseByVariantId(owner.caseId, owner.variantId, perCase, key)
    } else {
      confirmedBases.delete(slotKey); inFlightMutations.delete(slotKey); confirmedFieldPatches.delete(slotKey)
      const hasOther = Array.from(inFlightMutations.keys()).some((k) => k.endsWith(`:${key}`) && k !== slotKey)
      if (!hasOther) confirmedFieldPatches.delete(`perCase:${key}`)
      cacheSet(key, { global: entry.global, perCase: entry.perCase })
    }
  } else {
    cacheSetGlobalSlot(key, entry.global)
  }
}

// prettier-ignore
function applyStalePerCaseSlot(key: string, entry: AnnotationCache, caseId: number, reqVid?: number, startVidVer?: number, reqSeq?: number): void {
  const vidFresh = (reqVid === undefined || startVidVer === undefined || getCaseVariantVersion(caseId, reqVid) === startVidVer) &&
    (reqVid === undefined || reqSeq === undefined || !isLoadSeqStale(`caseVar:${caseId}:${reqVid}`, reqSeq))
  const unloaded = unloadedSlotOf(key)
  if (unloaded === 'global' && (reqSeq === undefined || !isLoadSeqStale(`global:${key}`, reqSeq))) {
    cacheSetGlobalSlot(key, entry.global)
  } else if (unloaded === 'perCase' && vidFresh && (reqSeq === undefined || !isLoadSeqStale(`case:${key}`, reqSeq))) {
    const pc = entry.perCase
    if (reqVid === undefined || pc === null || (pc.variant_id === reqVid && pc.case_id === caseId)) {
      const targetVid = reqVid ?? pc?.variant_id
      const sk = targetVid !== undefined ? perCaseSlotKey(caseId, targetVid, key) : `perCase:${key}`
      const inf = inFlightMutations.get(sk)
      const base = pc ? (applyConfirmedFieldPatches(sk, pc) as CaseVariantAnnotation) : null
      if (inf && inf.length > 0) confirmedBases.set(sk, base)
      const stored = inf && inf.length > 0 ? (computeOptimisticSlot(base, inf) as CaseVariantAnnotation | null) : pc
      cacheSetPerCaseSlot(key, stored, reqVid)
      if (targetVid !== undefined) setPerCaseByVariantId(caseId, targetVid, stored, key)
    }
  }
  if (reqVid !== undefined && startVidVer !== undefined && vidFresh) {
    const pc = entry.perCase
    if (pc === null || (pc.variant_id === reqVid && pc.case_id === caseId)) {
      if (reqSeq !== undefined) markLoadSeqAccepted(`caseVar:${caseId}:${reqVid}`, reqSeq)
      const sk = perCaseSlotKey(caseId, reqVid, key)
      const inf = inFlightMutations.get(sk)
      const base = pc ? (applyConfirmedFieldPatches(sk, pc) as CaseVariantAnnotation) : null
      if (inf && inf.length > 0) confirmedBases.set(sk, base)
      const stored = inf && inf.length > 0 ? (computeOptimisticSlot(base, inf) as CaseVariantAnnotation | null) : pc
      setPerCaseByVariantId(caseId, reqVid, stored, key)
      triggerAnnotationCache()
    }
  }
}

// prettier-ignore
async function load(api: WindowAPI | undefined, scope: AnnotationLoadScope, coords: VariantCoords): Promise<void> {
  if (!api || globalBuildOf(scope) === null) return
  const dbPath = beginAnnotationRequest(scopeCaseId(scope), scope.build)
  const key = variantKey(coords)
  const reqSeq = allocateLoadSeq()
  if (scope.kind === 'case' && typeof scope.variantId === 'number') {
    const ex = annotationCache.value.get(key)
    if (ex !== undefined && unloadedSlotOf(key) !== 'global' && hasLoadedPerCaseByVariantId(scope.caseId, scope.variantId) && hasPerCaseByVariantId(scope.caseId, scope.variantId)) {
      const pc = getPerCaseByVariantId(scope.caseId, scope.variantId, key) ?? null
      markLoadSeqAccepted(`case:${key}`, reqSeq); markLoadSeqAccepted(`caseVar:${scope.caseId}:${scope.variantId}`, reqSeq)
      ensurePerCaseSlotOwner(key, scope.caseId, scope.variantId); setCachedVariantId(key, scope.variantId)
      if (ex.perCase !== pc || unloadedSlotOf(key) === 'perCase') cacheSet(key, { global: ex.global, perCase: pc })
      return
    }
    const lVid = getLoadingVariantId(key)
    if ((ex !== undefined && ((ex.perCase != null && ex.perCase.variant_id !== scope.variantId) || (getCachedVariantId(key) !== undefined && getCachedVariantId(key) !== scope.variantId))) ||
        (isKeyLoading(key) && lVid !== undefined && lVid !== scope.variantId)) {
      evictCoordSlotOnly(key)
    }
  }
  if (!needsLoad(key, scope.kind)) return

  const version = getKeyVersion(key)
  const vidVer = scope.kind === 'case' && typeof scope.variantId === 'number' ? getCaseVariantVersion(scope.caseId, scope.variantId) : undefined
  const loadingToken = setLoading(key, true, scope.kind)
  if (scope.kind === 'case' && typeof scope.variantId === 'number') { setLoadingVariantId(key, scope.variantId); setLoadingCaseVariant(scope.caseId, scope.variantId, true) }
  try {
    let entry = await fetchEntry(api, scope, coords)
    if (isResponseStale(scope, dbPath)) return
    if (scope.kind === 'case' && typeof scope.variantId === 'number' && entry.perCase !== null && (entry.perCase.variant_id !== scope.variantId || entry.perCase.case_id !== scope.caseId)) {
      entry = { global: entry.global, perCase: null }
    }
    const vidStale = scope.kind === 'case' && typeof scope.variantId === 'number' &&
      ((vidVer !== undefined && getCaseVariantVersion(scope.caseId, scope.variantId) !== vidVer) || isLoadSeqStale(`caseVar:${scope.caseId}:${scope.variantId}`, reqSeq))
    const isStale = vidStale || isLoadSeqStale(`${scope.kind}:${key}`, reqSeq) || (scope.kind === 'case' ? getKeyVersion(key) !== version : getKeyVersion(key) % 1_000_000 !== version % 1_000_000)
    if (isStale) {
      if (scope.kind === 'case' && Math.floor(getKeyVersion(key) / 1_000_000) === Math.floor(version / 1_000_000)) {
        applyStalePerCaseSlot(key, entry, scope.caseId, scope.variantId, vidVer, reqSeq)
      }
      return
    }
    markLoadSeqAccepted(`${scope.kind}:${key}`, reqSeq)
    if (scope.kind === 'case' && typeof scope.variantId === 'number') {
      markLoadSeqAccepted(`caseVar:${scope.caseId}:${scope.variantId}`, reqSeq)
      ensurePerCaseSlotOwner(key, scope.caseId, scope.variantId)
    } else if (scope.kind === 'case' && entry.perCase !== null) {
      markLoadSeqAccepted(`caseVar:${entry.perCase.case_id}:${entry.perCase.variant_id}`, reqSeq)
    }
    storeLoaded(key, scope, entry)
    if (scope.kind === 'case' && typeof scope.variantId === 'number') {
      setCachedVariantId(key, scope.variantId)
      setPerCaseByVariantId(scope.caseId, scope.variantId, annotationCache.value.get(key)?.perCase ?? entry.perCase, key)
    }
  } catch (error) {
    logService.error(`Failed to load ${scopeQualifier(scope)}annotations: ` + getTransportErrorMessage(error), 'annotations')
  } finally {
    if (scope.kind === 'case' && typeof scope.variantId === 'number' && isTrackedCase(scope.caseId)) setLoadingCaseVariant(scope.caseId, scope.variantId, false)
    if (scope.kind !== 'case' || isTrackedCase(scope.caseId)) setLoading(key, false, scope.kind, loadingToken)
  }
}

/** A row to batch-load: per-case rows also carry their `variants.id`. */
export type BatchLoadVariant = VariantCoords & { id?: number; is_starred?: boolean }

// prettier-ignore
const batchKey = (scope: AnnotationLoadScope, v: BatchLoadVariant): BatchAnnotationKey => ({
  chr: v.chr, pos: v.pos, ref: v.ref, alt: v.alt,
  ...(scope.kind === 'case' && typeof v.id === 'number' ? { variantId: v.id } : {})
})

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
    // prettier-ignore
    if (scope.kind === 'case') {
      const cached = annotationCache.value.get(key)
      const cachedVid = getCachedVariantId(key)
      sameCoords = cached?.global?.chr === undefined || cached.global.chr === v.chr
      if (typeof v.id === 'number' && cached !== undefined && sameCoords && unloadedSlotOf(key) !== 'perCase' &&
          ((cached.perCase === null && (cachedVid === undefined || cachedVid === v.id)) || cached.perCase?.variant_id === v.id)) {
        setPerCaseByVariantId(scope.caseId, v.id, cached.perCase, key)
      }
      const targetVid = typeof v.id === 'number' ? v.id : cachedVid
      const vSlotKey = targetVid !== undefined ? perCaseSlotKey(scope.caseId, targetVid, key) : `perCase:${key}`
      const hasInFlight = inFlightMutations.has(vSlotKey) || inFlightMutations.has(`perCase:${key}`)
      let starStale = false
      if (typeof v.is_starred === 'boolean' && !hasInFlight) {
        if (typeof v.id === 'number' && hasLoadedPerCaseByVariantId(scope.caseId, v.id)) {
          starStale = (getPerCaseByVariantId(scope.caseId, v.id)?.starred === 1) !== v.is_starred
        } else if (cached !== undefined && (v.id === undefined || cached.perCase?.variant_id === v.id || (cached.perCase === null && cachedVid === v.id))) {
          starStale = (cached.perCase?.starred === 1) !== v.is_starred
        }
      }
      if (sameCoords && (starStale || (v.id === undefined && cached?.perCase != null))) {
        if (typeof v.id === 'number') evictPerCaseVariant(scope.caseId, v.id, key)
        else evictAnnotationCacheKeys([key])
      }
      const batchHasCachedVid = cachedVid !== undefined && variants.some((o) => o.id === cachedVid && variantKey(o) === key)
      const siblingSwitch = sameCoords && typeof v.id === 'number' && !batchHasCachedVid && cached !== undefined &&
        ((cached.perCase != null && cached.perCase.variant_id !== v.id) || (cachedVid !== undefined && cachedVid !== v.id))
      if (siblingSwitch) evictCoordSlotOnly(key)
    }
    // prettier-ignore
    const needCaseVid = scope.kind === 'case' && typeof v.id === 'number' && sameCoords &&
      !hasLoadedPerCaseByVariantId(scope.caseId, v.id) && !isLoadingCaseVariant(scope.caseId, v.id)
    if (needsLoad(key, scope.kind) || needCaseVid) neededVariants.push(v)
    else if (isKeyLoading(key)) markAwaited(scope.kind, key)
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

  const batchAwaited = new Set<string>()
  // prettier-ignore
  const checkAwaited = (k: string): boolean => {
    const a = takeAwaited(scope.kind, k) || batchAwaited.has(k)
    if (a) batchAwaited.add(k)
    return a
  }

  // prettier-ignore
  for (const uncached of waves) {
    const reqSeq = allocateLoadSeq()
    const requestedVariantIds = new Map<string, number>()
    const vidVersionsAtStart = new Map<string, number>()
    const keyVersionsAtStart = new Map<string, number>()
    const loadingTokensAtStart = new Map<string, number>()
    for (const vk of uncached) {
      const k = variantKey(vk)
      if (typeof vk.variantId === 'number') {
        requestedVariantIds.set(k, vk.variantId)
        if (scope.kind === 'case') { vidVersionsAtStart.set(k, getCaseVariantVersion(scope.caseId, vk.variantId)); setLoadingCaseVariant(scope.caseId, vk.variantId, true) }
      }
      keyVersionsAtStart.set(k, getKeyVersion(k)); loadingTokensAtStart.set(k, setLoading(k, true, scope.kind))
    }

    try {
      const results = unwrapIpcResult(await api.annotations.batchGet(scopeCaseId(scope), uncached, globalBuildOf(scope) ?? null))
      if (isResponseStale(scope, dbPath)) return
      const fromPriorPage = generation !== getAnnotationGeneration(scope.kind)
      for (const [key, value] of Object.entries(results)) {
        const startVer = keyVersionsAtStart.get(key)
        const reqVid = requestedVariantIds.get(key)
        const startVidVer = vidVersionsAtStart.get(key)
        const vidStale = scope.kind === 'case' && reqVid !== undefined &&
          ((startVidVer !== undefined && getCaseVariantVersion(scope.caseId, reqVid) !== startVidVer) || isLoadSeqStale(`caseVar:${scope.caseId}:${reqVid}`, reqSeq))
        if (startVer !== undefined || vidStale) {
          const keyStale = isLoadSeqStale(`${scope.kind}:${key}`, reqSeq) ||
            (startVer !== undefined && (scope.kind === 'case' ? getKeyVersion(key) !== startVer : getKeyVersion(key) % 1_000_000 !== versionOf(startVer)))
          if (keyStale || vidStale) {
            const sameEpoch = startVer === undefined || Math.floor(getKeyVersion(key) / 1_000_000) === Math.floor(startVer / 1_000_000)
            if (scope.kind === 'case' && sameEpoch && (!fromPriorPage || checkAwaited(key))) {
              applyStalePerCaseSlot(key, value as AnnotationCache, scope.caseId, reqVid, startVidVer, reqSeq)
            }
            continue
          }
        }
        if (fromPriorPage && !checkAwaited(key)) continue
        markLoadSeqAccepted(`${scope.kind}:${key}`, reqSeq)
        if (scope.kind === 'case' && reqVid !== undefined) {
          markLoadSeqAccepted(`caseVar:${scope.caseId}:${reqVid}`, reqSeq); ensurePerCaseSlotOwner(key, scope.caseId, reqVid)
        }
        storeLoaded(key, reqVid !== undefined && scope.kind === 'case' ? { ...scope, variantId: reqVid } : scope, value as AnnotationCache)
        if (scope.kind === 'case' && reqVid !== undefined) {
          const loaded = (value as AnnotationCache)?.perCase ?? null
          if (loaded === null || (loaded.variant_id === reqVid && loaded.case_id === scope.caseId)) setCachedVariantId(key, reqVid)
          const stored = isPerCaseSlotOwner(key, scope.caseId, reqVid) ? (annotationCache.value.get(key)?.perCase ?? loaded) : loaded
          setPerCaseByVariantId(scope.caseId, reqVid, stored, key)
        }
      }
    } catch (error) {
      logService.warn(`Failed to load ${scopeQualifier(scope)}annotation batch: ` + getTransportErrorMessage(error), 'annotations')
    } finally {
      for (const vk of uncached) {
        const k = variantKey(vk)
        if (scope.kind === 'case' && typeof vk.variantId === 'number') setLoadingCaseVariant(scope.caseId, vk.variantId, false)
        if (scope.kind !== 'case' || isTrackedCase(scope.caseId)) setLoading(k, false, scope.kind, loadingTokensAtStart.get(k))
      }
    }
  }
}

const versionOf = (v: number): number => v % 1_000_000

// prettier-ignore
export function createScopedAnnotationOps(api: WindowAPI | undefined, getUserName: () => string | undefined, onWriteFailed: (message?: string) => void = () => {}) {
  return {
    load: (scope: AnnotationLoadScope, coords: VariantCoords) => load(api, scope, coords),
    loadBatch: (scope: AnnotationLoadScope, variants: BatchLoadVariant[]) => loadBatch(api, scope, variants),
    toggleStar: (s: AnnotationWriteScope, c: VariantCoords, opts?: ToggleStarOptions) => mutate(api, onWriteFailed, s, c, 'star', (cur, base) => toggleStarPlan(s, cur, base, opts)),
    setAcmgClassification: (s: AnnotationWriteScope, c: VariantCoords, cl: AcmgClassification | null) => mutate(api, onWriteFailed, s, c, 'acmg', (_c, base) => acmgPlan(s, base, cl)),
    upsertComment: (s: AnnotationWriteScope, c: VariantCoords, comment: string | null) => mutate(api, onWriteFailed, s, c, 'comment', (_c, base) => commentPlan(s, base, comment)),
    setAcmgClassificationWithEvidence: (s: AnnotationWriteScope, c: VariantCoords, cl: AcmgClassification | null, ev: string) => mutate(api, onWriteFailed, s, c, 'acmg', () => acmgWithEvidencePlan(s, cl, ev, getUserName()))
  }
}
