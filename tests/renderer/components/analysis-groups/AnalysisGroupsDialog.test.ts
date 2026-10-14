import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import AnalysisGroupsDialog from '../../../../src/renderer/src/components/analysis-groups/AnalysisGroupsDialog.vue'
import PedImportPanel from '../../../../src/renderer/src/components/analysis-groups/PedImportPanel.vue'
import AnalysisGroupEditor from '../../../../src/renderer/src/components/analysis-groups/AnalysisGroupEditor.vue'
import { createMockApi } from '../../../utils/mock-api'

const vuetify = createVuetify({ components, directives })
type TestWindow = Window & { api?: unknown }

const PED = 'FAM1\tkid\tdad\tmom\t1\t2\nFAM1\tdad\t0\t0\t1\t1\nFAM1\tmom\t0\t0\t2\t1\n'
const CASES = [
  { id: 11, name: 'kid' },
  { id: 12, name: 'DAD' },
  { id: 13, name: 'unrelated' }
]

const body = (): HTMLElement => document.body
const byTestId = (id: string): HTMLElement | null =>
  body().querySelector<HTMLElement>(`[data-testid="${id}"]`)

describe('AnalysisGroupsDialog', () => {
  let api: ReturnType<typeof createMockApi>

  beforeEach(() => {
    body().innerHTML = ''
    api = createMockApi()
    ;(window as TestWindow).api = api
    api.cases.list.mockResolvedValue(CASES)
    api.analysisGroups.list.mockResolvedValue([
      {
        id: 5,
        name: 'Trio A',
        group_type: 'family',
        description: null,
        created_at: 0,
        updated_at: 0
      }
    ])
  })

  async function openDialog() {
    const wrapper = mount(AnalysisGroupsDialog, {
      global: { plugins: [vuetify] },
      attachTo: body()
    })
    await wrapper.find('[data-testid="analysis-groups-open"]').trigger('click')
    await flushPromises()
    return wrapper
  }

  it('imports a PED trio, shows the unmatched individual and creates the group', async () => {
    const wrapper = await openDialog()
    const panel = wrapper.findComponent(PedImportPanel)
    await (panel.vm as unknown as { readFile: (f: File) => Promise<void> }).readFile(
      new File([PED], 'trio.ped')
    )
    await flushPromises()
    byTestId('ped-preview')!.click()
    await flushPromises()

    expect(body().querySelectorAll('[data-testid="analysis-group-member"]')).toHaveLength(3)
    expect(body().textContent).toContain('No case matches PED individual mom')
    expect(byTestId('analysis-group-save')!.hasAttribute('disabled')).toBe(true)

    // Drop the unmatched mother explicitly, then save.
    const editor = wrapper.findComponent(AnalysisGroupEditor)
    const vm = editor.vm as unknown as { draft: { members: { individualId: string }[] } }
    expect(vm.draft.members.map((m) => m.individualId)).toEqual(['kid', 'dad', 'mom'])
    body().querySelector<HTMLElement>('[aria-label="Remove member 3"]')!.click()
    await flushPromises()
    api.analysisGroups.create.mockResolvedValue({ id: 9 })
    byTestId('analysis-group-save')!.click()
    await flushPromises()

    expect(api.analysisGroups.create).toHaveBeenCalledWith({ name: 'FAM1', groupType: 'family' })
    expect(api.analysisGroups.addMember.mock.calls.map((c) => c[0])).toEqual([
      { groupId: 9, caseId: 11, role: 'proband', affectedStatus: 'affected', individualId: 'kid' },
      { groupId: 9, caseId: 12, role: 'father', affectedStatus: 'unaffected', individualId: 'dad' }
    ])
    expect(api.analysisGroups.list).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('shows line-numbered PED errors instead of a preview', async () => {
    const wrapper = await openDialog()
    const panel = wrapper.findComponent(PedImportPanel)
    await (panel.vm as unknown as { readFile: (f: File) => Promise<void> }).readFile(
      new File(['FAM1 kid dad mom 7 2\n'], 'bad.ped')
    )
    await flushPromises()
    expect(byTestId('ped-errors')!.textContent).toContain('Line 1: invalid sex "7"')
    expect(byTestId('ped-preview')).toBeNull()
    wrapper.unmount()
  })

  it('edits a member role by removing and re-adding only that member', async () => {
    api.analysisGroups.get.mockResolvedValue({
      id: 5,
      name: 'Trio A',
      group_type: 'family',
      members: [
        {
          id: 1,
          group_id: 5,
          case_id: 11,
          role: 'proband',
          affected_status: 'affected',
          individual_id: null
        },
        {
          id: 2,
          group_id: 5,
          case_id: 12,
          role: 'other',
          affected_status: 'unknown',
          individual_id: null
        }
      ]
    })
    const wrapper = await openDialog()
    body().querySelector<HTMLElement>('[aria-label="Edit Trio A"]')!.click()
    await flushPromises()
    const editor = wrapper.findComponent(AnalysisGroupEditor)
    ;(editor.vm as unknown as { draft: { members: { role: string }[] } }).draft.members[1].role =
      'father'
    await flushPromises()
    byTestId('analysis-group-save')!.click()
    await flushPromises()

    expect(api.analysisGroups.create).not.toHaveBeenCalled()
    expect(api.analysisGroups.update).not.toHaveBeenCalled()
    expect(api.analysisGroups.removeMember).toHaveBeenCalledExactlyOnceWith(5, 12)
    expect(api.analysisGroups.addMember).toHaveBeenCalledExactlyOnceWith({
      groupId: 5,
      caseId: 12,
      role: 'father',
      affectedStatus: 'unknown',
      individualId: undefined
    })
    wrapper.unmount()
  })

  it('deletes a group only after confirmation', async () => {
    const wrapper = await openDialog()
    body().querySelector<HTMLElement>('[aria-label="Delete Trio A"]')!.click()
    await flushPromises()
    expect(api.analysisGroups.delete).not.toHaveBeenCalled()
    byTestId('analysis-groups-confirm-delete')!.click()
    await flushPromises()
    expect(api.analysisGroups.delete).toHaveBeenCalledWith(5)
    expect(wrapper.emitted('deleted')).toEqual([[5]])
    wrapper.unmount()
  })
})
