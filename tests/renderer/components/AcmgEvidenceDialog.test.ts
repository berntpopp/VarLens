import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import AcmgEvidenceDialog from '../../../src/renderer/src/components/AcmgEvidenceDialog.vue'
import AcmgEvidenceGrid from '../../../src/renderer/src/components/acmg/AcmgEvidenceGrid.vue'
import { installCapabilities } from '../helpers/capabilities'

const vuetify = createVuetify({ components, directives })

async function openDialog() {
  setActivePinia(createPinia())
  installCapabilities({ runtime: 'desktop', role: 'user' })
  const wrapper = mount(AcmgEvidenceDialog, {
    props: { evidenceJson: null, variantData: null, save: async () => true },
    global: { plugins: [vuetify] },
    attachTo: document.body
  })
  ;(wrapper.vm as unknown as { open: () => void }).open()
  await flushPromises()
  const outer = wrapper.findComponent({ name: 'VDialog' })
  return { wrapper, outer, isOpen: () => outer.props('modelValue') as boolean }
}

const click = (selector: string): void => document.querySelector<HTMLElement>(selector)!.click()

describe('AcmgEvidenceDialog unsaved draft', () => {
  it('closes at once without a draft', async () => {
    const { wrapper, isOpen } = await openDialog()
    click('[aria-label="Close"]')
    await flushPromises()
    expect(isOpen()).toBe(false)
    wrapper.unmount()
  })

  it('asks before the close button, Escape or a click outside drops a draft', async () => {
    const { wrapper, outer, isOpen } = await openDialog()
    wrapper.findAllComponents(AcmgEvidenceGrid)[0].vm.$emit('code-click', 'PVS1')
    await flushPromises()

    click('[aria-label="Close"]')
    await flushPromises()
    expect(isOpen()).toBe(true)
    click('[data-testid="acmg-leave-cancel"]')
    await flushPromises()
    expect(isOpen()).toBe(true)

    // Escape and a click outside both arrive as the dialog's own close request.
    outer.vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(isOpen()).toBe(true)
    click('[data-testid="acmg-leave-discard"]')
    await flushPromises()
    expect(isOpen()).toBe(false)
    wrapper.unmount()
  })
})
