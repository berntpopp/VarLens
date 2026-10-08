import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import AcmgClassificationPanel from '../../../src/renderer/src/components/AcmgClassificationPanel.vue'
import AcmgEvidenceGrid from '../../../src/renderer/src/components/acmg/AcmgEvidenceGrid.vue'
import { isInputFocused } from '../../../src/renderer/src/composables/useTableKeyboardNav'

const vuetify = createVuetify({ components, directives })

function mountPanel() {
  return mount(AcmgClassificationPanel, {
    props: { evidenceJson: null, variantData: null },
    global: { plugins: [vuetify] }
  })
}

describe('AcmgClassificationPanel confirm step', () => {
  it('keeps criterion clicks as a draft until Apply', async () => {
    const wrapper = mountPanel()
    const grid = wrapper.findAllComponents(AcmgEvidenceGrid)[0]
    grid.vm.$emit('code-click', 'PVS1')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('change')).toBeUndefined()
    const bar = wrapper.find('[data-testid="acmg-apply-bar"]')
    expect(bar.exists()).toBe(true)
    expect(bar.text()).toContain('PVS1')

    await wrapper.find('[data-testid="acmg-apply"]').trigger('click')
    const change = wrapper.emitted('change')?.[0]?.[0] as { evidenceJson: string }
    expect(JSON.parse(change.evidenceJson).pathogenic[0].code).toBe('PVS1')
    expect(wrapper.find('[data-testid="acmg-apply-bar"]').exists()).toBe(false)
  })

  it('Discard reverts the draft without writing', async () => {
    const wrapper = mountPanel()
    wrapper.findAllComponents(AcmgEvidenceGrid)[0].vm.$emit('code-click', 'PVS1')
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid="acmg-discard"]').trigger('click')
    expect(wrapper.emitted('change')).toBeUndefined()
    expect(wrapper.find('[data-testid="acmg-apply-bar"]').exists()).toBe(false)
  })

  it('toggling a criterion on and off again leaves nothing pending', async () => {
    const wrapper = mountPanel()
    const grid = wrapper.findAllComponents(AcmgEvidenceGrid)[0]
    grid.vm.$emit('code-click', 'PVS1')
    await wrapper.vm.$nextTick()
    grid.vm.$emit('code-click', 'PVS1')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="acmg-apply-bar"]').exists()).toBe(false)
  })

  it('keeps the draft pending when the save fails and rolls back', async () => {
    const wrapper = mountPanel()
    // A failed write shows its optimistic evidence, then restores the previous one.
    const save = async (draft: { evidenceJson: string }): Promise<boolean> => {
      await wrapper.setProps({ evidenceJson: draft.evidenceJson })
      await wrapper.setProps({ evidenceJson: null })
      return false
    }
    await wrapper.setProps({ save })
    wrapper.findAllComponents(AcmgEvidenceGrid)[0].vm.$emit('code-click', 'PVS1')
    await wrapper.vm.$nextTick()

    await wrapper.find('[data-testid="acmg-apply"]').trigger('click')
    await flushPromises()

    const bar = wrapper.find('[data-testid="acmg-apply-bar"]')
    expect(bar.exists()).toBe(true)
    expect(bar.text()).toContain('PVS1')
  })

  describe('leaving with an unsaved draft', () => {
    type Leave = { confirmLeave: () => Promise<boolean> | null }
    const click = (id: string): void =>
      document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!.click()

    async function draftPanel(save?: () => Promise<boolean>) {
      const wrapper = mount(AcmgClassificationPanel, {
        props: { evidenceJson: null, variantData: null, save },
        global: { plugins: [vuetify] },
        attachTo: document.body
      })
      wrapper.findAllComponents(AcmgEvidenceGrid)[0].vm.$emit('code-click', 'PVS1')
      await wrapper.vm.$nextTick()
      return wrapper
    }

    it('does not prompt without a draft', () => {
      const wrapper = mountPanel()
      expect((wrapper.vm as unknown as Leave).confirmLeave()).toBeNull()
    })

    it('Apply saves the draft, then lets the selection change', async () => {
      const saved: string[] = []
      const wrapper = await draftPanel(async () => {
        saved.push('saved')
        return true
      })
      const leave = (wrapper.vm as unknown as Leave).confirmLeave()
      await wrapper.vm.$nextTick()
      expect(document.querySelector('[data-testid="acmg-leave-prompt"]')).not.toBeNull()

      click('acmg-leave-apply')

      expect(await leave).toBe(true)
      expect(saved).toEqual(['saved'])
      wrapper.unmount()
    })

    it('stays when the applied save fails', async () => {
      const wrapper = await draftPanel(async () => false)
      const leave = (wrapper.vm as unknown as Leave).confirmLeave()
      await wrapper.vm.$nextTick()
      click('acmg-leave-apply')
      expect(await leave).toBe(false)
      expect(wrapper.find('[data-testid="acmg-apply-bar"]').exists()).toBe(true)
      wrapper.unmount()
    })

    it('Discard drops the draft and leaves', async () => {
      const wrapper = await draftPanel()
      const leave = (wrapper.vm as unknown as Leave).confirmLeave()
      await wrapper.vm.$nextTick()
      click('acmg-leave-discard')
      expect(await leave).toBe(true)
      expect(wrapper.emitted('change')).toBeUndefined()
      expect(wrapper.find('[data-testid="acmg-apply-bar"]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('Cancel and Escape keep the draft and stay', async () => {
      const wrapper = await draftPanel()
      const viaButton = (wrapper.vm as unknown as Leave).confirmLeave()
      await wrapper.vm.$nextTick()
      click('acmg-leave-cancel')
      expect(await viaButton).toBe(false)

      const viaEscape = (wrapper.vm as unknown as Leave).confirmLeave()
      await wrapper.vm.$nextTick()
      const outer = vi.fn()
      window.addEventListener('keydown', outer)
      document
        .querySelector('[data-testid="acmg-leave-prompt"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      window.removeEventListener('keydown', outer)
      expect(await viaEscape).toBe(false)
      // Escape must not also reach the details panel's and the table's own Escape handlers.
      expect(outer).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid="acmg-apply-bar"]').exists()).toBe(true)
      wrapper.unmount()
    })

    it('switches the table row shortcuts off while the prompt is open', async () => {
      const wrapper = await draftPanel()
      expect(isInputFocused()).toBe(false)
      const leave = (wrapper.vm as unknown as Leave).confirmLeave()
      await wrapper.vm.$nextTick()
      // s / c / a, the arrows and Enter all bail out on this check.
      expect(isInputFocused()).toBe(true)
      click('acmg-leave-cancel')
      await leave
      await wrapper.vm.$nextTick()
      expect(isInputFocused()).toBe(false)
      wrapper.unmount()
    })

    it('a rejected save answers "stay" instead of holding the selection forever', async () => {
      const wrapper = await draftPanel(() => Promise.reject(new Error('write failed')))
      wrapper.vm.$.appContext.config.errorHandler = () => {}
      const leave = (wrapper.vm as unknown as Leave).confirmLeave()
      await wrapper.vm.$nextTick()
      click('acmg-leave-apply')
      expect(await Promise.race([leave, flushPromises().then(() => 'held')])).toBe(false)
      wrapper.unmount()
    })

    it('a double click on Apply saves once', async () => {
      const save = vi.fn(async () => true)
      const wrapper = await draftPanel(save)
      const leave = (wrapper.vm as unknown as Leave).confirmLeave()
      await wrapper.vm.$nextTick()
      const apply = document.querySelector<HTMLElement>('[data-testid="acmg-leave-apply"]')!
      apply.click()
      apply.click()
      expect(await leave).toBe(true)
      expect(save).toHaveBeenCalledTimes(1)
      wrapper.unmount()
    })

    it('an evidence reload for the same variant keeps the draft and the prompt', async () => {
      const wrapper = await draftPanel()
      const leave = (wrapper.vm as unknown as Leave).confirmLeave()
      await wrapper.vm.$nextTick()

      // A late annotation load: the saved evidence arrives while the prompt is open.
      await wrapper.setProps({ evidenceJson: JSON.stringify({ pathogenic: [], benign: [] }) })

      expect(await Promise.race([leave, flushPromises().then(() => 'asking')])).toBe('asking')
      expect(wrapper.find('[data-testid="acmg-apply-bar"]').text()).toContain('PVS1')
      click('acmg-leave-cancel')
      expect(await leave).toBe(false)
      wrapper.unmount()
    })

    it('another variant still drops the draft and lets the selection change', async () => {
      const wrapper = await draftPanel()
      const leave = (wrapper.vm as unknown as Leave).confirmLeave()
      await wrapper.setProps({ variantData: { gnomad_af: null, cadd: null, clinvar: null } })
      expect(await leave).toBe(true)
      expect(wrapper.find('[data-testid="acmg-apply-bar"]').exists()).toBe(false)
      wrapper.unmount()
    })
  })
})
