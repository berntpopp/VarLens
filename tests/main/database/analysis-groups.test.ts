import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseService } from '../../../src/main/database'

describe('AnalysisGroupRepository', () => {
  let service: DatabaseService

  beforeEach(() => {
    service = new DatabaseService(':memory:')
  })

  afterEach(() => {
    service.close()
  })

  it('creates a family group', () => {
    const group = service.analysisGroups.createGroup('FAM001', 'family', 'Test family')
    expect(group.id).toBeGreaterThan(0)
    expect(group.name).toBe('FAM001')
    expect(group.group_type).toBe('family')
    expect(group.description).toBe('Test family')
  })

  it('lists groups ordered by creation', () => {
    service.analysisGroups.createGroup('FAM001')
    service.analysisGroups.createGroup('FAM002')
    const groups = service.analysisGroups.listGroups()
    expect(groups).toHaveLength(2)
  })

  it('adds members to a group', () => {
    const group = service.analysisGroups.createGroup('FAM001', 'family')
    const c1 = service.cases.createCase('proband', '/a.json', 100)
    const c2 = service.cases.createCase('father', '/b.json', 100)

    service.analysisGroups.addMember(group.id, c1, 'proband', 'affected')
    service.analysisGroups.addMember(group.id, c2, 'father', 'unaffected')

    const members = service.analysisGroups.getMembers(group.id)
    expect(members).toHaveLength(2)
    expect(members.find((m) => m.role === 'proband')?.case_id).toBe(c1)
    expect(members.find((m) => m.role === 'father')?.affected_status).toBe('unaffected')
  })

  it('getGroupWithMembers returns group with populated members', () => {
    const group = service.analysisGroups.createGroup('FAM001', 'family')
    const c1 = service.cases.createCase('proband', '/a.json', 100)
    service.analysisGroups.addMember(group.id, c1, 'proband', 'affected')

    const result = service.analysisGroups.getGroupWithMembers(group.id)
    expect(result.name).toBe('FAM001')
    expect(result.members).toHaveLength(1)
    expect(result.members[0].role).toBe('proband')
  })

  it('getGroupForCase returns the group a case belongs to', () => {
    const group = service.analysisGroups.createGroup('FAM001', 'family')
    const c1 = service.cases.createCase('proband', '/a.json', 100)
    service.analysisGroups.addMember(group.id, c1, 'proband', 'affected')

    const result = service.analysisGroups.getGroupForCase(c1)
    expect(result).not.toBeNull()
    expect(result!.id).toBe(group.id)
  })

  it('getGroupForCase returns null for unassigned case', () => {
    const c1 = service.cases.createCase('lonely', '/a.json', 100)
    expect(service.analysisGroups.getGroupForCase(c1)).toBeNull()
  })

  it('deleteGroup cascades to members', () => {
    const group = service.analysisGroups.createGroup('FAM001', 'family')
    const c1 = service.cases.createCase('proband', '/a.json', 100)
    service.analysisGroups.addMember(group.id, c1, 'proband', 'affected')

    service.analysisGroups.deleteGroup(group.id)
    const members = service.analysisGroups.getMembers(group.id)
    expect(members).toHaveLength(0)
  })

  it('updateGroup changes name and description', () => {
    const group = service.analysisGroups.createGroup('FAM001', 'family', 'Old desc')
    const updated = service.analysisGroups.updateGroup(group.id, {
      name: 'FAM001-v2',
      description: 'New desc'
    })
    expect(updated.name).toBe('FAM001-v2')
    expect(updated.description).toBe('New desc')
  })

  it('removeMember removes specific member', () => {
    const group = service.analysisGroups.createGroup('FAM001', 'family')
    const c1 = service.cases.createCase('proband', '/a.json', 100)
    const c2 = service.cases.createCase('father', '/b.json', 100)
    service.analysisGroups.addMember(group.id, c1, 'proband', 'affected')
    service.analysisGroups.addMember(group.id, c2, 'father', 'unaffected')

    service.analysisGroups.removeMember(group.id, c1)
    const members = service.analysisGroups.getMembers(group.id)
    expect(members).toHaveLength(1)
    expect(members[0].case_id).toBe(c2)
  })
})
