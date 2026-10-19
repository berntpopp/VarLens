import type {
  VariantAnnotation,
  CaseVariantAnnotation
} from '../../../shared/types/database-entities'
import type { GlobalAnnotationUpdates, PerCaseAnnotationUpdates } from '../../../shared/types/api'
import type { AcmgClassification } from '../../../shared/config/domain.config'

export type SlotValue = VariantAnnotation | CaseVariantAnnotation
export type SlotPatch = Partial<VariantAnnotation> & Partial<CaseVariantAnnotation>

export interface InFlightMutation {
  id: number
  fieldGroup: 'star' | 'acmg' | 'comment'
  writeVer: number
  patch: Record<string, unknown>
}

export function perCaseSlotKey(caseId: number, variantId: number, key: string): string {
  return `perCase:${caseId}:${variantId}:${key}`
}

export function perCaseVersionSlot(
  caseId: number,
  variantId: number,
  fg: 'star' | 'acmg' | 'comment'
): string {
  return `perCase:${caseId}:${variantId}:${fg}`
}

let nextMutationId = 0
export function allocateMutationId(): number {
  return ++nextMutationId
}

const MAX_TRACKED_ENTRIES = 5000

function setBoundedMap<K, V>(map: Map<K, V>, key: K, value: V): void {
  if (map.has(key)) map.delete(key)
  else {
    while (map.size >= MAX_TRACKED_ENTRIES) {
      const oldest = map.keys().next().value
      if (oldest === undefined) break
      map.delete(oldest)
    }
  }
  map.set(key, value)
}

const issuedWriteVersions = new Map<string, number>()
const confirmedWriteVersions = new Map<string, number>()
const maxVariantWriteVersions = new Map<string, number>()
export const confirmedFieldPatches = new Map<
  string,
  Partial<Record<'star' | 'acmg' | 'comment', SlotPatch>>
>()

export function bumpWriteVersion(key: string, slot: string = 'perCase'): number {
  const k = `${slot}:${key}`
  let base = issuedWriteVersions.get(k) ?? 0
  const parts = slot.split(':')
  if (parts.length === 4 && parts[0] === 'perCase') {
    const coordKey = `perCase:${parts[3]}:${key}`
    base = Math.max(base, issuedWriteVersions.get(coordKey) ?? 0)
    const next = base + 1
    setBoundedMap(issuedWriteVersions, k, next)
    setBoundedMap(
      maxVariantWriteVersions,
      coordKey,
      Math.max(maxVariantWriteVersions.get(coordKey) ?? 0, next)
    )
    return next
  }
  if (parts.length === 2 && parts[0] === 'perCase') {
    base = Math.max(base, maxVariantWriteVersions.get(k) ?? 0)
  }
  const next = base + 1
  setBoundedMap(issuedWriteVersions, k, next)
  return next
}

export function getWriteVersion(key: string, slot: string = 'perCase'): number {
  const v = issuedWriteVersions.get(`${slot}:${key}`) ?? 0
  const parts = slot.split(':')
  if (parts.length === 4 && parts[0] === 'perCase') {
    const coordKey = `perCase:${parts[3]}:${key}`
    return Math.max(v, issuedWriteVersions.get(coordKey) ?? 0)
  }
  return v
}

export function getConfirmedWriteVersion(key: string, slot: string = 'perCase'): number {
  const v = confirmedWriteVersions.get(`${slot}:${key}`) ?? 0
  const parts = slot.split(':')
  if (parts.length === 4 && parts[0] === 'perCase') {
    const coordKey = `perCase:${parts[3]}:${key}`
    return Math.max(v, confirmedWriteVersions.get(coordKey) ?? 0)
  }
  return v
}

export function setConfirmedWriteVersion(key: string, slot: string, version: number): void {
  const k = `${slot}:${key}`
  if (version > (confirmedWriteVersions.get(k) ?? 0)) {
    setBoundedMap(confirmedWriteVersions, k, version)
  }
  if (version > (issuedWriteVersions.get(k) ?? 0)) {
    setBoundedMap(issuedWriteVersions, k, version)
  }
}

export function retireWriteVersionsForVariant(
  coordKey: string,
  caseId: number,
  variantId: number
): void {
  for (const fg of ['star', 'acmg', 'comment'] as const) {
    const k = `${perCaseVersionSlot(caseId, variantId, fg)}:${coordKey}`
    issuedWriteVersions.delete(k)
    confirmedWriteVersions.delete(k)
  }
}

export function retireWriteVersionsForCoord(coordKey: string): void {
  for (const fg of ['star', 'acmg', 'comment'] as const) {
    for (const prefix of ['perCase', 'global'] as const) {
      const k = `${prefix}:${fg}:${coordKey}`
      issuedWriteVersions.delete(k)
      confirmedWriteVersions.delete(k)
      maxVariantWriteVersions.delete(k)
    }
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
  const patches = confirmedFieldPatches.get(slotKey)
  if (!patches || Object.keys(patches).length === 0) return base
  let merged: Record<string, unknown> = base ? { ...base } : {}
  if (!base && slotKey.startsWith('perCase:')) {
    const parts = slotKey.split(':')
    if (parts.length >= 4) {
      const cid = Number(parts[1])
      const vid = Number(parts[2])
      if (Number.isFinite(cid) && Number.isFinite(vid)) {
        merged = { case_id: cid, variant_id: vid }
      }
    }
  }
  for (const fg of ['star', 'acmg', 'comment'] as const) {
    if (patches[fg]) merged = { ...merged, ...patches[fg] }
  }
  return merged as unknown as SlotValue
}

export const confirmedBases = new Map<string, VariantAnnotation | CaseVariantAnnotation | null>()
export const inFlightMutations = new Map<string, InFlightMutation[]>()
export const perCaseSlotOwners = new Map<string, { caseId: number; variantId: number }>()

export function ensurePerCaseSlotOwner(key: string, caseId: number, variantId: number): void {
  setBoundedMap(perCaseSlotOwners, key, { caseId, variantId })
}

export function isPerCaseSlotOwner(key: string, caseId: number, variantId: number): boolean {
  const cur = perCaseSlotOwners.get(key)
  return !cur || (cur.caseId === caseId && cur.variantId === variantId)
}

export function getPerCaseSlotOwner(
  key: string
): { caseId: number; variantId: number } | undefined {
  return perCaseSlotOwners.get(key)
}

export const perCaseByVariantId = new Map<string, CaseVariantAnnotation | null>()
export const loadedPerCaseByVariantId = new Set<string>()
const variantKeysByCoord = new Map<string, Set<string>>()
const caseVariantVersions = new Map<string, number>()
let nextLoadSeq = 0
const acceptedLoadSeqs = new Map<string, number>()

export function allocateLoadSeq(): number {
  return ++nextLoadSeq
}

export function isLoadSeqStale(slot: string, seq: number): boolean {
  return (acceptedLoadSeqs.get(slot) ?? 0) > seq
}

export function markLoadSeqAccepted(slot: string, seq: number): void {
  if (seq > (acceptedLoadSeqs.get(slot) ?? 0)) {
    setBoundedMap(acceptedLoadSeqs, slot, seq)
  }
}

export function retireCoordLoadSeqs(coordKey: string): void {
  acceptedLoadSeqs.delete(`case:${coordKey}`)
  acceptedLoadSeqs.delete(`global:${coordKey}`)
}

const loadingVariantIds = new Map<string, number>()
export const getLoadingVariantId = (key: string): number | undefined => loadingVariantIds.get(key)
export const setLoadingVariantId = (key: string, vid: number): void =>
  void loadingVariantIds.set(key, vid)
export const deleteLoadingVariantId = (key: string): void => void loadingVariantIds.delete(key)

export function getCaseVariantVersion(caseId: number, variantId: number): number {
  return caseVariantVersions.get(`${caseId}:${variantId}`) ?? 0
}

export function bumpCaseVariantVersion(caseId: number, variantId: number): void {
  const k = `${caseId}:${variantId}`
  setBoundedMap(caseVariantVersions, k, (caseVariantVersions.get(k) ?? 0) + 1)
  setBoundedMap(acceptedLoadSeqs, `caseVar:${k}`, ++nextLoadSeq)
}

export function retireCaseVariantTracking(caseId: number, variantId: number): void {
  const k = `${caseId}:${variantId}`
  caseVariantVersions.delete(k)
  acceptedLoadSeqs.delete(`caseVar:${k}`)
}

export function setPerCaseByVariantId(
  caseId: number,
  variantId: number,
  pc: CaseVariantAnnotation | null,
  coordKey?: string,
  loaded: boolean = true
): void {
  const k = `${caseId}:${variantId}`
  setBoundedMap(perCaseByVariantId, k, pc)
  if (loaded) {
    loadedPerCaseByVariantId.delete(k)
    while (loadedPerCaseByVariantId.size >= MAX_TRACKED_ENTRIES) {
      const oldest = loadedPerCaseByVariantId.values().next().value
      if (oldest === undefined) break
      loadedPerCaseByVariantId.delete(oldest)
    }
    loadedPerCaseByVariantId.add(k)
  }
  if (typeof coordKey === 'string' && coordKey.length > 0) {
    let set = variantKeysByCoord.get(coordKey)
    if (!set) {
      set = new Set()
      setBoundedMap(variantKeysByCoord, coordKey, set)
    }
    set.add(k)
  }
}

export function hasInFlightMutationsForCoord(coordKey: string): boolean {
  if (inFlightMutations.has(`perCase:${coordKey}`) || inFlightMutations.has(`global:${coordKey}`)) {
    return true
  }
  const set = variantKeysByCoord.get(coordKey)
  if (set) {
    for (const k of set) {
      const [cid, vid] = k.split(':').map(Number)
      if (inFlightMutations.has(perCaseSlotKey(cid, vid, coordKey))) return true
    }
  }
  return Array.from(inFlightMutations.keys()).some((sk) => sk.endsWith(`:${coordKey}`))
}

export function cleanupUnloadedPerCaseVariant(
  coordKey: string,
  caseId: number,
  variantId: number,
  shouldKeepLoadGuard?: (caseId: number, variantId: number) => boolean,
  retireVersions: boolean = true
): void {
  const k = `${caseId}:${variantId}`
  loadedPerCaseByVariantId.delete(k)
  perCaseByVariantId.delete(k)
  const set = variantKeysByCoord.get(coordKey)
  if (set) {
    set.delete(k)
    if (set.size === 0) variantKeysByCoord.delete(coordKey)
  }
  if (shouldKeepLoadGuard?.(caseId, variantId) === true) {
    bumpCaseVariantVersion(caseId, variantId)
  } else {
    retireCaseVariantTracking(caseId, variantId)
  }
  if (retireVersions) {
    retireWriteVersionsForVariant(coordKey, caseId, variantId)
    if (!hasInFlightMutationsForCoord(coordKey)) {
      retireWriteVersionsForCoord(coordKey)
    }
  }
}

export function deletePerCaseForCoordKey(
  coordKey: string,
  shouldKeepLoadGuard?: (caseId: number, variantId: number) => boolean,
  retireWriteVersions: boolean = true
): void {
  const set = variantKeysByCoord.get(coordKey)
  if (set) {
    for (const k of Array.from(set)) {
      const [cid, vid] = k.split(':').map(Number)
      loadedPerCaseByVariantId.delete(k)
      const hasMut = inFlightMutations.has(perCaseSlotKey(cid, vid, coordKey))
      if (!hasMut) {
        perCaseByVariantId.delete(k)
        set.delete(k)
        if (retireWriteVersions) {
          retireWriteVersionsForVariant(coordKey, cid, vid)
        }
      }
      if (hasMut || shouldKeepLoadGuard?.(cid, vid) === true) {
        bumpCaseVariantVersion(cid, vid)
      } else {
        retireCaseVariantTracking(cid, vid)
      }
    }
    if (set.size === 0) variantKeysByCoord.delete(coordKey)
  }
  if (retireWriteVersions && !hasInFlightMutationsForCoord(coordKey)) {
    retireWriteVersionsForCoord(coordKey)
  }
}

export function hasPerCaseByVariantId(caseId: number, variantId: number): boolean {
  return perCaseByVariantId.has(`${caseId}:${variantId}`)
}

export function hasLoadedPerCaseByVariantId(caseId: number, variantId: number): boolean {
  const k = `${caseId}:${variantId}`
  return loadedPerCaseByVariantId.has(k) && perCaseByVariantId.has(k)
}

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

// prettier-ignore
export function removeInFlightMutation(slotKey: string, mutationId: number): void {
  const list = inFlightMutations.get(slotKey)
  if (!list) return
  const filtered = list.filter((m) => m.id !== mutationId)
  if (filtered.length === 0) inFlightMutations.delete(slotKey)
  else inFlightMutations.set(slotKey, filtered)
}

// prettier-ignore
export function pruneInFlightMutationsOnSuccess(slotKey: string, fieldGroup: string, writeVer: number): void {
  const list = inFlightMutations.get(slotKey)
  if (!list) return
  const filtered = list.filter((m) => !(m.fieldGroup === fieldGroup && m.writeVer <= writeVer))
  if (filtered.length === 0) {
    inFlightMutations.delete(slotKey); confirmedBases.delete(slotKey)
  } else {
    inFlightMutations.set(slotKey, filtered)
  }
}

export function clearMutationTracker(): void {
  for (const m of [
    confirmedWriteVersions,
    confirmedFieldPatches,
    confirmedBases,
    inFlightMutations,
    perCaseSlotOwners,
    perCaseByVariantId,
    loadedPerCaseByVariantId,
    variantKeysByCoord,
    caseVariantVersions,
    acceptedLoadSeqs,
    loadingVariantIds
  ]) {
    m.clear()
  }
}

export function resetMutationTracker(): void {
  issuedWriteVersions.clear()
  maxVariantWriteVersions.clear()
  nextLoadSeq = 0
  clearMutationTracker()
}

export type AnnotationWriteScope =
  | { kind: 'case'; caseId: number; variantId: number; build: string | null }
  | { kind: 'global'; build: string | null }

export function extractFieldGroupPatch(
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

export type AnnotationUpdates = GlobalAnnotationUpdates & PerCaseAnnotationUpdates

export interface ToggleStarOptions {
  initialStarred?: boolean
  logSource?: string
  isStillActive?: () => boolean
}

export interface MutationPlan {
  optimistic: SlotPatch
  updates: AnnotationUpdates
  rollback: SlotPatch | 'restore-previous'
  failureMessage: string
  logSource?: string
  isStillActive?: () => boolean
}

export function toggleStarPlan(
  scope: AnnotationWriteScope,
  cur: SlotValue | null,
  base: SlotValue | null,
  opts?: ToggleStarOptions
): MutationPlan {
  const wasStarred = cur !== null ? cur.starred === 1 : (opts?.initialStarred ?? false)
  const baseStarred = base !== null ? base.starred === 1 : (opts?.initialStarred ?? false)
  return {
    optimistic: { starred: wasStarred ? 0 : 1 },
    updates: { starred: !wasStarred },
    rollback: { starred: baseStarred ? 1 : 0 },
    failureMessage: `Failed to toggle ${scope.kind === 'global' ? 'global ' : ''}star: `,
    logSource: opts?.logSource,
    isStillActive: opts?.isStillActive
  }
}

// prettier-ignore
export function acmgPlan(scope: AnnotationWriteScope, base: SlotValue | null, classification: AcmgClassification | null): MutationPlan {
  return {
    optimistic: { acmg_classification: classification },
    updates: { acmg_classification: classification },
    rollback: { acmg_classification: base?.acmg_classification ?? null },
    failureMessage: `Failed to set ${scope.kind === 'global' ? 'global ' : ''}ACMG classification: `
  }
}

// prettier-ignore
export function commentPlan(scope: AnnotationWriteScope, base: SlotValue | null, comment: string | null): MutationPlan {
  const isCase = scope.kind === 'case'
  const patch = isCase ? { per_case_comment: comment } : { global_comment: comment }
  const roll = isCase ? { per_case_comment: (base as CaseVariantAnnotation | null)?.per_case_comment ?? null } : { global_comment: (base as VariantAnnotation | null)?.global_comment ?? null }
  return { optimistic: patch, updates: patch, rollback: roll, failureMessage: `Failed to upsert ${isCase ? 'per-case' : 'global'} comment: ` }
}

// prettier-ignore
export function acmgWithEvidencePlan(scope: AnnotationWriteScope, classification: AcmgClassification | null, evidenceJson: string, userName: string | undefined): MutationPlan {
  return {
    optimistic: { acmg_classification: classification, acmg_evidence: evidenceJson },
    updates: { acmg_classification: classification, acmg_evidence: evidenceJson, user_name: userName },
    rollback: 'restore-previous',
    failureMessage: `Failed to set ${scope.kind === 'global' ? 'global ' : ''}ACMG classification with evidence: `
  }
}

// prettier-ignore
function applyBulkUpdatesPatch(slotKey: string, fg: 'star' | 'acmg' | 'comment', u: Record<string, unknown>): void {
  if (fg === 'star' && ('starred' in u || 'is_starred' in u)) {
    setConfirmedFieldPatch(slotKey, 'star', { starred: Number(Boolean(u.starred ?? u.is_starred)) })
  } else if (fg === 'acmg' && ('acmg_classification' in u || 'acmg_evidence' in u)) {
    const patch: SlotPatch = { ...(confirmedFieldPatches.get(slotKey)?.acmg ?? {}) }
    if ('acmg_classification' in u) patch.acmg_classification = (u.acmg_classification as SlotPatch['acmg_classification']) ?? null
    if ('acmg_evidence' in u) patch.acmg_evidence = (u.acmg_evidence as string | null) ?? null
    setConfirmedFieldPatch(slotKey, 'acmg', patch)
  } else if (fg === 'comment' && 'per_case_comment' in u) {
    setConfirmedFieldPatch(slotKey, 'comment', { per_case_comment: (u.per_case_comment as string | null) ?? null })
  }
}

export function reconcileBulkTriageKey(
  key: string,
  touchedFields: Array<'star' | 'acmg' | 'comment'>,
  bulkWriteVersions: Map<string, Map<string, number>>,
  updates: Record<string, unknown> | undefined,
  owners: Array<{ caseId: number; variantId: number }>,
  fromCurrentEpoch: boolean,
  hasInFlightForKey: boolean,
  shouldKeepLoadGuard?: (caseId: number, variantId: number) => boolean
): void {
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
      const hasCurrentActivity =
        !fromCurrentEpoch &&
        (getConfirmedWriteVersion(key, vSlot) > 0 ||
          (inFlightMutations.get(slotKey)?.some((m) => m.fieldGroup === fg) ?? false) ||
          (inFlightMutations.get(`perCase:${key}`)?.some((m) => m.fieldGroup === fg) ?? false))
      if (hasCurrentActivity) continue
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
  if (fromCurrentEpoch || !hasInFlightForKey) {
    deletePerCaseForCoordKey(key, shouldKeepLoadGuard, false)
  }
  for (const o of owners) {
    loadedPerCaseByVariantId.delete(`${o.caseId}:${o.variantId}`)
    const sk = perCaseSlotKey(o.caseId, o.variantId, key)
    const rem = inFlightMutations.get(sk)
    if (rem && rem.length > 0) {
      bumpCaseVariantVersion(o.caseId, o.variantId)
      setPerCaseByVariantId(
        o.caseId,
        o.variantId,
        computeOptimisticSlot(
          applyConfirmedFieldPatches(sk, confirmedBases.get(sk) ?? null),
          rem
        ) as CaseVariantAnnotation | null,
        key,
        false
      )
    } else {
      perCaseByVariantId.delete(`${o.caseId}:${o.variantId}`)
      const set = variantKeysByCoord.get(key)
      if (set) {
        set.delete(`${o.caseId}:${o.variantId}`)
        if (set.size === 0) variantKeysByCoord.delete(key)
      }
      if (shouldKeepLoadGuard?.(o.caseId, o.variantId) === true) {
        bumpCaseVariantVersion(o.caseId, o.variantId)
      } else {
        retireCaseVariantTracking(o.caseId, o.variantId)
      }
    }
  }
}
