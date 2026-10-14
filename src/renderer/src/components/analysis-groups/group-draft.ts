/**
 * Draft model for the analysis-group editor: the form state, its PED-derived
 * preview, and the save that turns it into existing `analysisGroups.*` IPC calls.
 */
import type { AnalysisGroup, AnalysisGroupMember, WindowAPI } from '../../../../shared/types/api'
import type { AffectedStatusValue, AnalysisGroupRole } from '../../../../shared/types/database'
import { unwrapIpcResult } from '../../../../shared/types/errors'
import { logService } from '../../services/LogService'
import { formatError } from '../../utils/ipc-result'
import { derivePedRoles, type PedIndividual } from '../../../../shared/utils/ped-parser'

export interface MemberDraft {
  caseId: number | null
  role: AnalysisGroupRole
  affectedStatus: AffectedStatusValue
  individualId: string | null
}

export interface GroupDraft {
  id: number | null
  name: string
  groupType: 'family' | 'tumor_normal'
  members: MemberDraft[]
}

export interface CaseOption {
  id: number
  name: string
}

export const FAMILY_ROLES: AnalysisGroupRole[] = [
  'proband',
  'mother',
  'father',
  'sibling',
  'partner',
  'other'
]
export const TUMOR_NORMAL_ROLES: AnalysisGroupRole[] = ['tumor', 'normal']
export const AFFECTED_STATUSES: AffectedStatusValue[] = ['affected', 'unaffected', 'unknown']

/** Plain copy (structuredClone rejects Vue reactive proxies). */
export const cloneDraft = (d: GroupDraft): GroupDraft => ({
  ...d,
  members: d.members.map((m) => ({ ...m }))
})

/** Exact case-name match, else a unique case-insensitive match, else null. */
export function matchCase(individualId: string, cases: CaseOption[]): number | null {
  const exact = cases.find((c) => c.name === individualId)
  if (exact) return exact.id
  const lower = individualId.toLowerCase()
  const loose = cases.filter((c) => c.name.toLowerCase() === lower)
  return loose.length === 1 ? loose[0].id : null
}

/** One PED family as an unsaved group; unmatched individuals keep `caseId: null`. */
export function draftFromPed(
  familyId: string,
  family: PedIndividual[],
  cases: CaseOption[]
): GroupDraft {
  const roles = derivePedRoles(family)
  return {
    id: null,
    name: familyId,
    groupType: 'family',
    members: family.map((ind) => ({
      caseId: matchCase(ind.individualId, cases),
      role: roles.get(ind.individualId) ?? 'other',
      affectedStatus: ind.phenotype,
      individualId: ind.individualId
    }))
  }
}

/** Why the draft cannot be saved yet, or null when it can. */
export function draftProblem(draft: GroupDraft): string | null {
  if (draft.name.trim() === '') return 'Enter a group name.'
  if (draft.members.some((m) => m.caseId === null)) {
    return 'Assign a case to every member or remove the unmatched ones.'
  }
  const ids = draft.members.map((m) => m.caseId)
  if (new Set(ids).size !== ids.length) return 'A case can only be a member once.'
  return null
}

const sameMember = (a: MemberDraft, b: MemberDraft): boolean =>
  a.caseId === b.caseId &&
  a.role === b.role &&
  a.affectedStatus === b.affectedStatus &&
  (a.individualId ?? null) === (b.individualId ?? null)

/** Form state of a persisted group as returned by `analysisGroups.get`. */
export function draftFromGroup(
  group: AnalysisGroup & { members: AnalysisGroupMember[] }
): GroupDraft {
  return {
    id: group.id,
    name: group.name,
    groupType: group.group_type === 'tumor_normal' ? 'tumor_normal' : 'family',
    members: group.members.map((m) => ({
      caseId: m.case_id,
      role: m.role as AnalysisGroupRole,
      affectedStatus: m.affected_status as AffectedStatusValue,
      individualId: m.individual_id
    }))
  }
}

/**
 * Turn the members `from` into `to`. There is no update-member channel, so a changed
 * member is removed and re-added; removals run first because a case is unique per group.
 */
async function syncMembers(
  api: WindowAPI,
  groupId: number,
  from: MemberDraft[],
  to: MemberDraft[]
): Promise<void> {
  for (const old of from) {
    if (!to.some((m) => sameMember(m, old))) {
      unwrapIpcResult(await api.analysisGroups.removeMember(groupId, old.caseId as number))
    }
  }
  for (const member of to) {
    if (from.some((old) => sameMember(member, old))) continue
    unwrapIpcResult(
      await api.analysisGroups.addMember({
        groupId,
        caseId: member.caseId as number,
        role: member.role,
        affectedStatus: member.affectedStatus,
        individualId: member.individualId ?? undefined
      })
    )
  }
}

/** Best-effort undo of a failed edit: bring the stored group back to `original`. */
async function restoreGroup(api: WindowAPI, groupId: number, original: GroupDraft): Promise<void> {
  try {
    const current = draftFromGroup(unwrapIpcResult(await api.analysisGroups.get(groupId)))
    if (current.name !== original.name) {
      unwrapIpcResult(await api.analysisGroups.update(groupId, { name: original.name }))
    }
    await syncMembers(api, groupId, current.members, original.members)
  } catch (err) {
    logService.error(`Could not restore group ${groupId}: ${formatError(err)}`, 'group-draft')
  }
}

async function deleteQuietly(api: WindowAPI, groupId: number): Promise<void> {
  try {
    unwrapIpcResult(await api.analysisGroups.delete(groupId))
  } catch (err) {
    logService.error(`Could not roll back group ${groupId}: ${formatError(err)}`, 'group-draft')
  }
}

/**
 * Persist a draft with the existing per-row IPC calls. The calls are not one transaction,
 * so a failure rolls back: a new group is deleted, an edited group is restored.
 */
export async function saveGroupDraft(
  api: WindowAPI,
  draft: GroupDraft,
  original: GroupDraft | null
): Promise<number> {
  const name = draft.name.trim()
  if (draft.id === null) {
    const groupId = unwrapIpcResult(
      await api.analysisGroups.create({ name, groupType: draft.groupType })
    ).id
    try {
      await syncMembers(api, groupId, [], draft.members)
    } catch (err) {
      // Without this a retry of Save would create a second, duplicate group.
      await deleteQuietly(api, groupId)
      throw err
    }
    return groupId
  }
  const groupId = draft.id
  try {
    if (original && original.name !== name) {
      unwrapIpcResult(await api.analysisGroups.update(groupId, { name }))
    }
    await syncMembers(api, groupId, original?.members ?? [], draft.members)
  } catch (err) {
    if (original) await restoreGroup(api, groupId, original)
    throw err
  }
  return groupId
}
