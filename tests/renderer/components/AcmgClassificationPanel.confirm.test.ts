import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import AcmgClassificationPanel from '../../../src/renderer/src/components/AcmgClassificationPanel.vue'
import AcmgEvidenceGrid from '../../../src/renderer/src/components/acmg/AcmgEvidenceGrid.vue'

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
})
