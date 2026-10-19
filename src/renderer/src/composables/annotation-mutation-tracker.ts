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

const issuedWriteVersions = new Map<string, number>()
const confirmedWriteVersions = new Map<string, number>()
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
    issuedWriteVersions.set(coordKey, base + 1)
  }
  const next = base + 1
  issuedWriteVersions.set(k, next)
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

export const confirmedBases = new Map<string, VariantAnnotation | CaseVariantAnnotation | null>()
export const inFlightMutations = new Map<string, InFlightMutation[]>()
export const perCaseSlotOwners = new Map<string, { caseId: number; variantId: number }>()

export function ensurePerCaseSlotOwner(key: string, caseId: number, variantId: number): void {
  perCaseSlotOwners.set(key, { caseId, variantId })
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
const variantKeysByCoord = new Map<string, Set<string>>()

export function setPerCaseByVariantId(
  caseId: number,
  variantId: number,
  pc: CaseVariantAnnotation | null,
  coordKey?: string
): void {
  const k = `${caseId}:${variantId}`
  perCaseByVariantId.set(k, pc)
  if (typeof coordKey === 'string' && coordKey.length > 0) {
    let set = variantKeysByCoord.get(coordKey)
    if (!set) {
      set = new Set()
      variantKeysByCoord.set(coordKey, set)
    }
    set.add(k)
  }
}

export function deletePerCaseForCoordKey(coordKey: string): void {
  const set = variantKeysByCoord.get(coordKey)
  if (set) {
    for (const k of set) {
      perCaseByVariantId.delete(k)
    }
    variantKeysByCoord.delete(coordKey)
  }
}

export function hasPerCaseByVariantId(caseId: number, variantId: number): boolean {
  return perCaseByVariantId.has(`${caseId}:${variantId}`)
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
    confirmedBases.delete(slotKey)
  } else {
    inFlightMutations.set(slotKey, filtered)
  }
}

export function clearMutationTracker(): void {
  issuedWriteVersions.clear()
  confirmedWriteVersions.clear()
  confirmedFieldPatches.clear()
  confirmedBases.clear()
  inFlightMutations.clear()
  perCaseSlotOwners.clear()
  perCaseByVariantId.clear()
  variantKeysByCoord.clear()
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

export interface MutationPlan {
  optimistic: SlotPatch
  updates: AnnotationUpdates
  rollback: SlotPatch | 'restore-previous'
  failureMessage: string
}

export function toggleStarPlan(
  scope: AnnotationWriteScope,
  cur: SlotValue | null,
  base: SlotValue | null
): MutationPlan {
  const wasStarred = cur?.starred === 1
  return {
    optimistic: { starred: wasStarred ? 0 : 1 },
    updates: { starred: !wasStarred },
    rollback: { starred: base?.starred === 1 ? 1 : 0 },
    failureMessage: `Failed to toggle ${scope.kind === 'global' ? 'global ' : ''}star: `
  }
}

export function acmgPlan(
  scope: AnnotationWriteScope,
  base: SlotValue | null,
  classification: AcmgClassification | null
): MutationPlan {
  return {
    optimistic: { acmg_classification: classification },
    updates: { acmg_classification: classification },
    rollback: { acmg_classification: base?.acmg_classification ?? null },
    failureMessage: `Failed to set ${scope.kind === 'global' ? 'global ' : ''}ACMG classification: `
  }
}

export function commentPlan(
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

export function acmgWithEvidencePlan(
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
    failureMessage: `Failed to set ${scope.kind === 'global' ? 'global ' : ''}ACMG classification with evidence: `
  }
}
