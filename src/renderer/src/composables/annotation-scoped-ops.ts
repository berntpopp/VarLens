/**
 * Scope-parameterised annotation operations.
 * Binds load and optimistic mutations to per-case and global scopes.
 */

import { logService } from '../services/LogService'
import { BUILD_COPY, GENOME_BUILDS } from '../../../shared/config/genome-builds.config'
import type {
  WindowAPI,
  BatchAnnotationKey,
  GlobalAnnotationUpdates,
  PerCaseAnnotationUpdates
} from '../../../shared/types/api'
import type {
  VariantAnnotation,
  CaseVariantAnnotation
} from '../../../shared/types/database-entities'
import type { AcmgClassification } from '../../../shared/config/domain.config'
import { isIpcError, unwrapIpcResult } from '../../../shared/types/errors'
import {
  annotationCache,
  applyConfirmedFieldPatches,
  beginAnnotationRequest,
  bumpKeyVersion,
  bumpWriteVersion,
  cacheSet,
  cacheSetGlobalSlot,
  cacheSetPerCaseSlot,
  computeOptimisticSlot,
  confirmedBases,
  confirmedFieldPatches,
  dropCacheOfClosedDatabase,
  ensurePerCaseSlotOwner,
  evictAnnotationCacheKeys,
  getAnnotationCacheEpoch,
  getAnnotationGeneration,
  getCachedVariantId,
  getConfirmedWriteVersion,
  getKeyVersion,
  hasDbSwitchedSince,
  inFlightMutations,
  isCacheOfBuild,
  isKeyLoading,
  isPerCaseSlotOwner,
  isTrackedCase,
  markAwaited,
  mergeServerSlot,
  needsLoad,
  otherSlot,
  pruneInFlightMutationsOnSuccess,
  readSlot,
  removeInFlightMutation,
  rollBackSlot,
  setCachedVariantId,
  setConfirmedFieldPatch,
  setConfirmedWriteVersion,
  setLoading,
  slotIdentity,
  slotOf,
  takeAwaited,
  triggerAnnotationCache,
  unloadedSlotOf,
  variantKey,
  writeSlot,
  type AnnotationCache,
  type SlotPatch,
  type SlotValue,
  type VariantCoords
} from './annotation-cache'

/** Scope of a load: one case, or global. */
export type AnnotationLoadScope =
  { kind: 'case'; caseId: number; build: string | null } | { kind: 'global'; build: string | null }

/** Scope of a write: per-case writes also identify the variant row. */
export type AnnotationWriteScope =
  | { kind: 'case'; caseId: number; variantId: number; build: string | null }
  | { kind: 'global'; build: string | null }

export function globalScope(build: string | null): { kind: 'global'; build: string | null } {
  return { kind: 'global', build }
}
const globalBuildOf = (scope: AnnotationLoadScope): string | null | undefined =>
  scope.kind === 'global' ? scope.build : undefined

function extractFieldGroupPatch(
  scope: AnnotationWriteScope,
  fieldGroup: 'star' | 'acmg' | 'comment',
  updated: SlotValue
): SlotPatch {
  if (updated === null) return {}
  if (fieldGroup === 'star') return 'starred' in updated ? { starred: updated.starred } : {}
  if (fieldGroup === 'acmg') {
    const p: SlotPatch = {}
    if ('acmg_classification' in updated) p.acmg_classification = updated.acmg_classification
    if ('acmg_evidence' in updated) p.acmg_evidence = updated.acmg_evidence
    return p
  }
  const commentKey = scope.kind === 'case' ? 'per_case_comment' : 'global_comment'
  return commentKey in updated
    ? { [commentKey]: (updated as unknown as Record<string, unknown>)[commentKey] }
    : {}
}

type AnnotationUpdates = GlobalAnnotationUpdates & PerCaseAnnotationUpdates

interface MutationPlan {
  optimistic: SlotPatch
  updates: AnnotationUpdates
  rollback: SlotPatch | 'restore-previous'
  failureMessage: string
}

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

let nextMutationId = 0

function toggleStarPlan(
  scope: AnnotationWriteScope,
  cur: SlotValue | null,
  base: SlotValue | null
): MutationPlan {
  const wasStarred = cur?.starred === 1
  return {
    optimistic: { starred: wasStarred ? 0 : 1 },
    updates: { starred: !wasStarred },
    rollback: { starred: base?.starred === 1 ? 1 : 0 },
    failureMessage: `Failed to toggle ${scopeQualifier(scope)}star: `
  }
}

function acmgPlan(
  scope: AnnotationWriteScope,
  base: SlotValue | null,
  classification: AcmgClassification | null
): MutationPlan {
  return {
    optimistic: { acmg_classification: classification },
    updates: { acmg_classification: classification },
    rollback: { acmg_classification: base?.acmg_classification ?? null },
    failureMessage: `Failed to set ${scopeQualifier(scope)}ACMG classification: `
  }
}

function commentPlan(
  scope: AnnotationWriteScope,
  base: SlotValue | null,
  comment: string | null
): MutationPlan {
  const isCase = scope.kind === 'case'
  const patch = isCase ? { per_case_comment: comment } : { global_comment: comment }
  const roll = isCase
    ? { per_case_comment: (base as CaseVariantAnnotation | null)?.per_case_comment ?? null }
    : { global_comment: (base as VariantAnnotation | null)?.global_comment ?? null }
  return {
    optimistic: patch,
    updates: patch,
    rollback: roll,
    failureMessage: `Failed to upsert ${isCase ? 'per-case' : 'global'} comment: `
  }
}

function acmgWithEvidencePlan(
  scope: AnnotationWriteScope,
  classification: AcmgClassification | null,
  evidenceJson: string,
  userName: string | undefined
): MutationPlan {
  return {
    optimistic: { acmg_classification: classification, acmg_evidence: evidenceJson },
    updates: {
      acmg_classification: classification,
      acmg_evidence: evidenceJson,
      user_name: userName
    },
    rollback: 'restore-previous',
    failureMessage: `Failed to set ${scopeQualifier(scope)}ACMG classification with evidence: `
  }
}

function upsert(
  client: WindowAPI,
  scope: AnnotationWriteScope,
  coords: VariantCoords,
  updates: AnnotationUpdates
) {
  if (scope.kind === 'case') {
    return client.annotations.upsertPerCase(scope.caseId, scope.variantId, updates)
  }
  if (scope.build === null) throw new Error('genome build unknown; global annotation not saved')
  if (!GENOME_BUILDS.some((b) => b.id === scope.build)) {
    throw new UnconfirmedBuildError(BUILD_COPY.globalNotesNeedBuild)
  }
  const { chr, pos, ref, alt } = coords
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
  const rawCurrent = annotationCache.value.get(key)
  const pc = rawCurrent?.perCase
  const siblingOccupied =
    scope.kind === 'case' &&
    pc != null &&
    (pc.variant_id !== scope.variantId || pc.case_id !== scope.caseId)
  const current = siblingOccupied ? undefined : rawCurrent
  const curSlot = (current ? readSlot(current, scope) : null) ?? null
  const slot = slotOf(scope)
  const slotKey = `${slot}:${key}`
  if (scope.kind === 'case') ensurePerCaseSlotOwner(key, scope.caseId, scope.variantId)
  const baseSlot = confirmedBases.get(slotKey) ?? curSlot
  const plan = buildPlan(curSlot, baseSlot)

  const writeVer = bumpWriteVersion(key, `${slot}:${fieldGroup}`)
  const mutationId = ++nextMutationId

  if (current) {
    if (!confirmedBases.has(slotKey)) {
      confirmedBases.set(slotKey, baseSlot ? { ...baseSlot } : null)
    }
    const list = inFlightMutations.get(slotKey) ?? []
    list.push({
      id: mutationId,
      fieldGroup,
      writeVer,
      patch: { ...plan.optimistic, ...slotIdentity(scope) }
    })
    inFlightMutations.set(slotKey, list)
    writeSlot(current, scope, computeOptimisticSlot(confirmedBases.get(slotKey) ?? null, list))
    triggerAnnotationCache()
  }

  try {
    const updated = unwrapIpcResult<SlotValue>(await upsert(api, scope, coords, plan.updates))
    if (
      leftScope(scope, dbPath) ||
      (scope.kind === 'case' && !isPerCaseSlotOwner(key, scope.caseId, scope.variantId)) ||
      writeVer <= getConfirmedWriteVersion(key, `${slot}:${fieldGroup}`)
    ) {
      removeInFlightMutation(slotKey, mutationId)
      return true
    }
    setConfirmedWriteVersion(key, `${slot}:${fieldGroup}`, writeVer)
    setConfirmedFieldPatch(slotKey, fieldGroup, extractFieldGroupPatch(scope, fieldGroup, updated))
    pruneInFlightMutationsOnSuccess(slotKey, fieldGroup, writeVer)

    const remaining = inFlightMutations.get(slotKey)
    const mergedConfirmed = applyConfirmedFieldPatches(slotKey, updated)!
    if (!remaining || remaining.length === 0) {
      confirmedBases.delete(slotKey)
      inFlightMutations.delete(slotKey)
    } else {
      confirmedBases.set(slotKey, mergedConfirmed)
    }

    const live = annotationCache.value.get(key)
    if (epoch !== getAnnotationCacheEpoch() && !live) return true
    const written = slot
    const unloaded = live ? unloadedSlotOf(key) : otherSlot(written)
    bumpKeyVersion(key)
    const finalSlot =
      remaining && remaining.length > 0
        ? computeOptimisticSlot(mergedConfirmed, remaining)
        : mergedConfirmed
    cacheSet(
      key,
      mergeServerSlot(live, scope, finalSlot!),
      unloaded === written ? undefined : unloaded
    )
    return true
  } catch (error) {
    const wasActive =
      (inFlightMutations.get(slotKey)?.some((m) => m.id === mutationId) ?? false) &&
      (scope.kind !== 'case' || isPerCaseSlotOwner(key, scope.caseId, scope.variantId))
    removeInFlightMutation(slotKey, mutationId)
    logService.error(plan.failureMessage + getTransportErrorMessage(error), 'annotations')
    onWriteFailed(error instanceof UnconfirmedBuildError ? error.message : undefined)
    if (leftScope(scope, dbPath)) return false

    if (wasActive) {
      const target =
        (epoch === getAnnotationCacheEpoch() ? annotationCache.value.get(key) : undefined) ??
        current
      if (target && confirmedBases.has(slotKey)) {
        const remaining = inFlightMutations.get(slotKey)
        const base = applyConfirmedFieldPatches(slotKey, confirmedBases.get(slotKey) ?? null)
        if (remaining && remaining.length > 0) {
          writeSlot(target, scope, computeOptimisticSlot(base, remaining))
        } else {
          if (base !== null) writeSlot(target, scope, { ...base })
          else rollBackSlot(target, scope, plan.rollback, null)
          confirmedBases.delete(slotKey)
          inFlightMutations.delete(slotKey)
        }
      } else if (target) {
        rollBackSlot(target, scope, plan.rollback, baseSlot)
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
    const slotKey = `perCase:${key}`
    if (entry.perCase !== null) {
      ensurePerCaseSlotOwner(key, entry.perCase.case_id, entry.perCase.variant_id)
      const writeScope: AnnotationWriteScope = {
        kind: 'case',
        caseId: entry.perCase.case_id,
        variantId: entry.perCase.variant_id,
        build: scope.build
      }
      for (const fg of ['star', 'acmg', 'comment'] as const) {
        if (confirmedFieldPatches.get(slotKey)?.[fg] === undefined) {
          setConfirmedFieldPatch(slotKey, fg, extractFieldGroupPatch(writeScope, fg, entry.perCase))
        }
      }
    }
    const inFlight = inFlightMutations.get(slotKey)
    const basePerCase = entry.perCase
      ? (applyConfirmedFieldPatches(slotKey, entry.perCase) as CaseVariantAnnotation)
      : null
    if (inFlight && inFlight.length > 0) {
      confirmedBases.set(slotKey, basePerCase)
      const perCase = computeOptimisticSlot(basePerCase, inFlight) as CaseVariantAnnotation | null
      cacheSet(key, { global: entry.global, perCase })
    } else {
      confirmedBases.delete(slotKey)
      inFlightMutations.delete(slotKey)
      if (entry.perCase === null) confirmedFieldPatches.delete(slotKey)
      cacheSet(key, { global: entry.global, perCase: basePerCase })
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
  const uncachedByKey = new Map<string, BatchAnnotationKey>()
  for (const v of variants) {
    const key = variantKey(v)
    if (scope.kind === 'case') {
      const cached = annotationCache.value.get(key)
      const cachedVid = getCachedVariantId(key)
      const sameCoords = cached?.global?.chr === undefined || cached.global.chr === v.chr
      const stale =
        (cached !== undefined &&
          ((typeof v.id === 'number' &&
            cached.perCase != null &&
            cached.perCase.variant_id !== v.id) ||
            (typeof v.is_starred === 'boolean' &&
              !inFlightMutations.has(`perCase:${key}`) &&
              (cached.perCase?.starred === 1) !== v.is_starred))) ||
        (typeof v.id === 'number' && cachedVid !== undefined && cachedVid !== v.id)
      if (sameCoords && stale) evictAnnotationCacheKeys([key])
    }
    if (needsLoad(key, scope.kind)) uncachedByKey.set(key, batchKey(scope, v))
    else if (isKeyLoading(key)) markAwaited(scope.kind, key)
  }
  if (uncachedByKey.size === 0) return
  const uncached = Array.from(uncachedByKey.values())

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
        if (loaded === null || (loaded.variant_id === reqVid && loaded.case_id === scope.caseId)) {
          setCachedVariantId(key, reqVid)
        }
      }
    }
  } catch (error) {
    logService.warn(
      `Failed to load ${scopeQualifier(scope)}annotation batch: ` + getTransportErrorMessage(error),
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

export function createScopedAnnotationOps(
  api: WindowAPI | undefined,
  getUserName: () => string | undefined,
  onWriteFailed: (message?: string) => void = () => {}
) {
  return {
    load: (scope: AnnotationLoadScope, coords: VariantCoords) => load(api, scope, coords),
    loadBatch: (scope: AnnotationLoadScope, variants: BatchLoadVariant[]) =>
      loadBatch(api, scope, variants),
    toggleStar: (s: AnnotationWriteScope, c: VariantCoords) =>
      mutate(api, onWriteFailed, s, c, 'star', (cur, base) => toggleStarPlan(s, cur, base)),
    setAcmgClassification: (
      s: AnnotationWriteScope,
      c: VariantCoords,
      cl: AcmgClassification | null
    ) => mutate(api, onWriteFailed, s, c, 'acmg', (_c, base) => acmgPlan(s, base, cl)),
    upsertComment: (s: AnnotationWriteScope, c: VariantCoords, comment: string | null) =>
      mutate(api, onWriteFailed, s, c, 'comment', (_c, base) => commentPlan(s, base, comment)),
    setAcmgClassificationWithEvidence: (
      s: AnnotationWriteScope,
      c: VariantCoords,
      cl: AcmgClassification | null,
      ev: string
    ) =>
      mutate(api, onWriteFailed, s, c, 'acmg', () => acmgWithEvidencePlan(s, cl, ev, getUserName()))
  }
}
