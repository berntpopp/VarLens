/**
 * Scope-parameterised annotation operations.
 *
 * Every load and optimistic mutation is written once and takes the scope it
 * runs in — `{ kind: 'case', … }` for per-case annotations or
 * `GLOBAL_SCOPE` for global ones. `useAnnotations()` binds these to its
 * public per-case / global function pairs.
 *
 * The few places where the two scopes genuinely differ (which cache slot,
 * which IPC call, the case-switch guard, the batch generation guard, log
 * wording) are the `scope.kind` switches below.
 */

import { logService } from '../services/LogService'
import type { WindowAPI } from '../../../shared/types/api'
import type {
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
  beginAnnotationRequest,
  cacheSet,
  cacheSetGlobalSlot,
  dropCacheOfClosedDatabase,
  getAnnotationCacheEpoch,
  getAnnotationGeneration,
  hasDbSwitchedSince,
  isKeyLoading,
  isTrackedCase,
  markAwaited,
  needsLoad,
  setLoading,
  takeAwaited,
  triggerAnnotationCache,
  unloadedSlotOf,
  variantKey,
  type AnnotationCache,
  type AnnotationSlot,
  type VariantCoords
} from './annotation-cache'

/** Scope of a load: one case, or global (cohort mode — no case needed). */
export type AnnotationLoadScope = { kind: 'case'; caseId: number } | { kind: 'global' }

/** Scope of a write: per-case writes also identify the variant row. */
export type AnnotationWriteScope =
  { kind: 'case'; caseId: number; variantId: number } | { kind: 'global' }

export const GLOBAL_SCOPE = { kind: 'global' } as const

type SlotValue = VariantAnnotation | CaseVariantAnnotation
type SlotPatch = Partial<VariantAnnotation> & Partial<CaseVariantAnnotation>
type AnnotationUpdates = GlobalAnnotationUpdates & PerCaseAnnotationUpdates

/** One optimistic write, described independently of the scope plumbing. */
interface MutationPlan {
  /** Fields written to the cached slot before the IPC call. */
  optimistic: SlotPatch
  /** Payload sent to the upsert IPC. */
  updates: AnnotationUpdates
  /** On failure: re-apply these fields, or restore the whole previous slot. */
  rollback: SlotPatch | 'restore-previous'
  /** Log prefix, e.g. `Failed to toggle star: `. */
  failureMessage: string
}

function getTransportErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (isIpcError(error)) return error.userMessage ?? error.message
  return String(error)
}

function scopeCaseId(scope: AnnotationLoadScope): number | null {
  return scope.kind === 'case' ? scope.caseId : null
}

/** `global ` in log messages for the global scope, empty for per-case. */
function scopeQualifier(scope: AnnotationLoadScope): string {
  return scope.kind === 'global' ? 'global ' : ''
}

/** Discard a response when the database (or, per case, the case) switched while awaiting. */
function isResponseStale(scope: AnnotationLoadScope, requestDbPath: string | null): boolean {
  if (hasDbSwitchedSince(requestDbPath)) return true
  return scope.kind === 'case' && !isTrackedCase(scope.caseId)
}

/**
 * True when a write settled after its database or case was left. The write
 * must then not touch the cache — and if the cache still holds the old
 * database (nothing has queried the new one yet), it is emptied so the
 * write's optimistic value is not served any longer.
 */
function leftScope(scope: AnnotationWriteScope, requestDbPath: string | null): boolean {
  if (!isResponseStale(scope, requestDbPath)) return false
  dropCacheOfClosedDatabase()
  return true
}

function slotOf(scope: AnnotationLoadScope): AnnotationSlot {
  return scope.kind === 'case' ? 'perCase' : 'global'
}

function otherSlot(slot: AnnotationSlot): AnnotationSlot {
  return slot === 'perCase' ? 'global' : 'perCase'
}

function readSlot(entry: AnnotationCache, scope: AnnotationLoadScope): SlotValue | null {
  return scope.kind === 'case' ? entry.perCase : entry.global
}

function writeSlot(
  entry: AnnotationCache,
  scope: AnnotationLoadScope,
  value: SlotValue | null
): void {
  if (scope.kind === 'case') entry.perCase = value as CaseVariantAnnotation | null
  else entry.global = value as VariantAnnotation | null
}

/** Per-case rows always carry their identity; global rows are keyed by coordinates. */
function slotIdentity(scope: AnnotationWriteScope): SlotPatch {
  return scope.kind === 'case' ? { case_id: scope.caseId, variant_id: scope.variantId } : {}
}

/** The cache entry after the server confirmed a write to this scope's slot. */
function mergeServerSlot(
  current: AnnotationCache | undefined,
  scope: AnnotationWriteScope,
  updated: SlotValue
): AnnotationCache {
  if (scope.kind === 'case') {
    return { global: current?.global ?? null, perCase: updated as CaseVariantAnnotation }
  }
  return { global: updated as VariantAnnotation, perCase: current?.perCase ?? null }
}

function rollBackSlot(
  current: AnnotationCache,
  scope: AnnotationWriteScope,
  plan: MutationPlan,
  previous: SlotValue | null
): void {
  if (plan.rollback === 'restore-previous') {
    writeSlot(current, scope, previous)
    return
  }
  writeSlot(current, scope, { ...readSlot(current, scope), ...plan.rollback } as SlotValue)
}

function toggleStarPlan(scope: AnnotationWriteScope, previous: SlotValue | null): MutationPlan {
  const wasStarred = previous?.starred === 1
  return {
    optimistic: { starred: wasStarred ? 0 : 1 },
    updates: { starred: !wasStarred },
    rollback: { starred: wasStarred ? 1 : 0 },
    failureMessage: `Failed to toggle ${scopeQualifier(scope)}star: `
  }
}

function acmgPlan(
  scope: AnnotationWriteScope,
  previous: SlotValue | null,
  classification: AcmgClassification | null
): MutationPlan {
  return {
    optimistic: { acmg_classification: classification },
    updates: { acmg_classification: classification },
    rollback: { acmg_classification: previous?.acmg_classification ?? null },
    failureMessage: `Failed to set ${scopeQualifier(scope)}ACMG classification: `
  }
}

function commentPlan(
  scope: AnnotationWriteScope,
  current: AnnotationCache | undefined,
  comment: string | null
): MutationPlan {
  if (scope.kind === 'case') {
    return {
      optimistic: { per_case_comment: comment },
      updates: { per_case_comment: comment },
      rollback: { per_case_comment: current?.perCase?.per_case_comment ?? null },
      failureMessage: 'Failed to upsert per-case comment: '
    }
  }
  return {
    optimistic: { global_comment: comment },
    updates: { global_comment: comment },
    rollback: { global_comment: current?.global?.global_comment ?? null },
    failureMessage: 'Failed to upsert global comment: '
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
  return client.annotations.upsertGlobal(coords.chr, coords.pos, coords.ref, coords.alt, updates)
}

/**
 * Optimistically apply a write, confirm it over IPC, roll back on failure.
 * Resolves `false` when nothing was saved, after telling the user (#486).
 */
async function mutate(
  api: WindowAPI | undefined,
  onWriteFailed: () => void,
  scope: AnnotationWriteScope,
  coords: VariantCoords,
  buildPlan: (current: AnnotationCache | undefined, previous: SlotValue | null) => MutationPlan
): Promise<boolean> {
  if (!api) return false
  const dbPath = beginAnnotationRequest(scopeCaseId(scope))
  const epoch = getAnnotationCacheEpoch()
  const key = variantKey(coords)
  const current = annotationCache.value.get(key)
  const previous = (current ? readSlot(current, scope) : null) ?? null
  const plan = buildPlan(current, previous)

  if (current) {
    const optimistic = { ...readSlot(current, scope), ...plan.optimistic, ...slotIdentity(scope) }
    writeSlot(current, scope, optimistic as SlotValue)
    triggerAnnotationCache()
  }

  try {
    const updated = unwrapIpcResult<SlotValue>(await upsert(api, scope, coords, plan.updates))
    if (leftScope(scope, dbPath)) return true
    // Merge into what the cache holds now. If the cache was rebuilt while the
    // write was in flight (case switch), `current` belongs to the old scope:
    // update the entry the new scope loaded, and never recreate one from it.
    const live = annotationCache.value.get(key)
    if (epoch !== getAnnotationCacheEpoch() && !live) return true
    // The write confirms its own slot; the other one stays as (un)loaded as it was.
    const written = slotOf(scope)
    const unloaded = live ? unloadedSlotOf(key) : otherSlot(written)
    cacheSet(
      key,
      mergeServerSlot(live, scope, updated),
      unloaded === written ? undefined : unloaded
    )
    return true
  } catch (error) {
    logService.error(plan.failureMessage + getTransportErrorMessage(error), 'annotations')
    onWriteFailed()
    if (leftScope(scope, dbPath)) return false
    // Every failed write rolls back and notifies, so no view keeps showing the
    // optimistic value of a write that never landed.
    if (current) rollBackSlot(current, scope, plan, previous)
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
  const global = unwrapIpcResult(await client.annotations.getGlobal(chr, pos, ref, alt))
  return { global, perCase: null }
}

/** Cache a load result: a per-case load fills both slots, a global load only its own. */
function storeLoaded(key: string, scope: AnnotationLoadScope, entry: AnnotationCache): void {
  if (scope.kind === 'case') cacheSet(key, entry)
  else cacheSetGlobalSlot(key, entry.global)
}

/** Load annotations for one variant (call on row visible or expand). */
async function load(
  api: WindowAPI | undefined,
  scope: AnnotationLoadScope,
  coords: VariantCoords
): Promise<void> {
  if (!api) return
  const dbPath = beginAnnotationRequest(scopeCaseId(scope))
  const key = variantKey(coords)
  if (!needsLoad(key, scope.kind)) return

  setLoading(key, true, scope.kind)
  try {
    const entry = await fetchEntry(api, scope, coords)
    if (isResponseStale(scope, dbPath)) return
    storeLoaded(key, scope, entry)
  } catch (error) {
    logService.error(
      `Failed to load ${scopeQualifier(scope)}annotations: ` + getTransportErrorMessage(error),
      'annotations'
    )
  } finally {
    setLoading(key, false)
  }
}

/** A row to batch-load: per-case rows also carry their `variants.id`. */
export type BatchLoadVariant = VariantCoords & { id?: number }

/**
 * The key sent to `annotations:batchGet`. Per-case keys MUST carry `variantId`
 * (`BatchAnnotationKey` in shared/types/api.ts): without it the server matches
 * per-case annotations by coordinates alone, so a row would show the annotation
 * of another variant row of the same case that shares its chr:pos:ref:alt.
 */
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
  if (!api) return
  const dbPath = beginAnnotationRequest(scopeCaseId(scope))
  // Captured at call time — used to detect results from a prior page.
  const generation = getAnnotationGeneration(scope.kind)

  // Filter out cached AND in-flight keys to prevent duplicate IPC calls
  const uncached: BatchAnnotationKey[] = []
  for (const v of variants) {
    const key = variantKey(v)
    if (needsLoad(key, scope.kind)) uncached.push(batchKey(scope, v))
    // Already in flight: rely on that request, even if its batch is later
    // found to belong to a previous page.
    else if (isKeyLoading(key)) markAwaited(scope.kind, key)
  }
  if (uncached.length === 0) return

  // Mark all keys as in-flight before the IPC call
  for (const vk of uncached) setLoading(variantKey(vk), true, scope.kind)

  try {
    const results = unwrapIpcResult(await api.annotations.batchGet(scopeCaseId(scope), uncached))
    if (isResponseStale(scope, dbPath)) return
    // When this scope's table paged meanwhile the batch is discarded, except
    // for the rows the current page is still waiting for.
    const fromPriorPage = generation !== getAnnotationGeneration(scope.kind)
    for (const [key, value] of Object.entries(results)) {
      const awaited = takeAwaited(scope.kind, key)
      if (fromPriorPage && !awaited) continue
      storeLoaded(key, scope, value as AnnotationCache)
    }
  } catch (error) {
    logService.warn(
      `Failed to load ${scopeQualifier(scope)}annotation batch: ` + getTransportErrorMessage(error),
      'annotations'
    )
  } finally {
    for (const vk of uncached) setLoading(variantKey(vk), false)
  }
}

/**
 * Bind the scope-parameterised operations to an API client. Each returned
 * function takes the scope first, so one implementation serves both the
 * per-case and the global public functions of `useAnnotations()`.
 */
export function createScopedAnnotationOps(
  api: WindowAPI | undefined,
  getUserName: () => string | undefined,
  onWriteFailed: () => void = () => {}
) {
  return {
    load: (scope: AnnotationLoadScope, coords: VariantCoords) => load(api, scope, coords),
    loadBatch: (scope: AnnotationLoadScope, variants: BatchLoadVariant[]) =>
      loadBatch(api, scope, variants),
    toggleStar: (scope: AnnotationWriteScope, coords: VariantCoords) =>
      mutate(api, onWriteFailed, scope, coords, (_current, previous) =>
        toggleStarPlan(scope, previous)
      ),
    setAcmgClassification: (
      scope: AnnotationWriteScope,
      coords: VariantCoords,
      classification: AcmgClassification | null
    ) =>
      mutate(api, onWriteFailed, scope, coords, (_current, previous) =>
        acmgPlan(scope, previous, classification)
      ),
    upsertComment: (scope: AnnotationWriteScope, coords: VariantCoords, comment: string | null) =>
      mutate(api, onWriteFailed, scope, coords, (current) => commentPlan(scope, current, comment)),
    setAcmgClassificationWithEvidence: (
      scope: AnnotationWriteScope,
      coords: VariantCoords,
      classification: AcmgClassification | null,
      evidenceJson: string
    ) =>
      mutate(api, onWriteFailed, scope, coords, () =>
        acmgWithEvidencePlan(scope, classification, evidenceJson, getUserName())
      )
  }
}
