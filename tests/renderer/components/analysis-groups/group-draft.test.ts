import { beforeEach, describe, expect, it } from 'vitest'

import {
  saveGroupDraft,
  type GroupDraft
} from '../../../../src/renderer/src/components/analysis-groups/group-draft'
import type { WindowAPI } from '../../../../src/shared/types/api'
import { createMockApi } from '../../../utils/mock-api'

const kid = { caseId: 11, role: 'proband', affectedStatus: 'affected', individualId: null } as const
const dad = { caseId: 12, role: 'other', affectedStatus: 'unknown', individualId: null } as const

describe('saveGroupDraft rollback', () => {
  let api: ReturnType<typeof createMockApi>
  beforeEach(() => {
    api = createMockApi()
  })

  it('deletes a newly created group when adding a member fails', async () => {
    api.analysisGroups.create.mockResolvedValue({ id: 9 })
    api.analysisGroups.addMember.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('boom'))
    const draft: GroupDraft = { id: null, name: 'F', groupType: 'family', members: [kid, dad] }

    await expect(saveGroupDraft(api as unknown as WindowAPI, draft, null)).rejects.toThrow('boom')
    expect(api.analysisGroups.delete).toHaveBeenCalledExactlyOnceWith(9)
  })

  it('restores the original members when an edit fails half way', async () => {
    const original: GroupDraft = { id: 5, name: 'T', groupType: 'family', members: [kid, dad] }
    const draft: GroupDraft = { ...original, members: [kid, { ...dad, role: 'father' }] }
    api.analysisGroups.addMember.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({})
    // State after the failed edit: dad was removed, his re-add failed.
    api.analysisGroups.get.mockResolvedValue({
      id: 5,
      name: 'T',
      group_type: 'family',
      members: [{ case_id: 11, role: 'proband', affected_status: 'affected', individual_id: null }]
    })

    await expect(saveGroupDraft(api as unknown as WindowAPI, draft, original)).rejects.toThrow(
      'boom'
    )
    expect(api.analysisGroups.removeMember).toHaveBeenCalledExactlyOnceWith(5, 12)
    expect(api.analysisGroups.addMember).toHaveBeenLastCalledWith({
      groupId: 5,
      caseId: 12,
      role: 'other',
      affectedStatus: 'unknown',
      individualId: undefined
    })
    expect(api.analysisGroups.delete).not.toHaveBeenCalled()
  })
})
