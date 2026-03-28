import { BaseRepository } from './BaseRepository'
import type {
  AnalysisGroup,
  AnalysisGroupMember,
  AnalysisGroupWithMembers,
  AnalysisGroupRole,
  AffectedStatusValue
} from './types'

export class AnalysisGroupRepository extends BaseRepository {
  listGroups(): AnalysisGroup[] {
    return this.db
      .prepare('SELECT * FROM analysis_groups ORDER BY created_at DESC')
      .all() as AnalysisGroup[]
  }

  createGroup(
    name: string,
    groupType: 'family' | 'tumor_normal' = 'family',
    description?: string
  ): AnalysisGroup {
    const now = Date.now()
    const result = this.db
      .prepare(
        'INSERT INTO analysis_groups (name, group_type, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(name, groupType, description ?? null, now, now)
    return this.getGroup(result.lastInsertRowid as number)
  }

  getGroup(id: number): AnalysisGroup {
    const row = this.db.prepare('SELECT * FROM analysis_groups WHERE id = ?').get(id) as
      | AnalysisGroup
      | undefined
    if (!row) throw new Error(`Analysis group ${id} not found`)
    return row
  }

  getGroupWithMembers(id: number): AnalysisGroupWithMembers {
    const group = this.getGroup(id)
    const members = this.getMembers(id)
    return { ...group, members }
  }

  getGroupForCase(caseId: number): AnalysisGroup | null {
    const member = this.db
      .prepare('SELECT group_id FROM analysis_group_members WHERE case_id = ? LIMIT 1')
      .get(caseId) as { group_id: number } | undefined
    if (!member) return null
    return this.getGroup(member.group_id)
  }

  updateGroup(id: number, updates: { name?: string; description?: string | null }): AnalysisGroup {
    const group = this.getGroup(id)
    const newDescription =
      updates.description === undefined ? group.description : updates.description
    this.db
      .prepare('UPDATE analysis_groups SET name = ?, description = ?, updated_at = ? WHERE id = ?')
      .run(updates.name ?? group.name, newDescription, Date.now(), id)
    return this.getGroup(id)
  }

  deleteGroup(id: number): void {
    this.db.prepare('DELETE FROM analysis_groups WHERE id = ?').run(id)
  }

  addMember(
    groupId: number,
    caseId: number,
    role: AnalysisGroupRole,
    affectedStatus: AffectedStatusValue = 'unknown',
    individualId?: string
  ): AnalysisGroupMember {
    const result = this.db
      .prepare(
        'INSERT INTO analysis_group_members (group_id, case_id, role, affected_status, individual_id) VALUES (?, ?, ?, ?, ?)'
      )
      .run(groupId, caseId, role, affectedStatus, individualId ?? null)
    return this.db
      .prepare('SELECT * FROM analysis_group_members WHERE id = ?')
      .get(result.lastInsertRowid as number) as AnalysisGroupMember
  }

  removeMember(groupId: number, caseId: number): void {
    this.db
      .prepare('DELETE FROM analysis_group_members WHERE group_id = ? AND case_id = ?')
      .run(groupId, caseId)
  }

  getMembers(groupId: number): AnalysisGroupMember[] {
    return this.db
      .prepare('SELECT * FROM analysis_group_members WHERE group_id = ? ORDER BY role')
      .all(groupId) as AnalysisGroupMember[]
  }
}
