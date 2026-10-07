import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import EmptyState from '../../../src/renderer/src/components/EmptyState.vue'
import { AppStateKey, createAppState } from '../../../src/renderer/src/composables/useAppState'

const vuetify = createVuetify({ components, directives })

function mountWithState(hasCases: boolean) {
  const appState = createAppState()
  const wrapper = mount(EmptyState, {
    props: { hasCases },
    global: { plugins: [vuetify], provide: { [AppStateKey as symbol]: appState } }
  })
  return { wrapper, appState }
}

describe('EmptyState first impression', () => {
  it('renders neither CTA while the case list is still loading', () => {
    const { wrapper } = mountWithState(false)
    const cta = wrapper.find('.empty-state__cta')
    expect(cta.exists()).toBe(true)
    expect(cta.attributes('aria-busy')).toBe('true')
    expect(wrapper.text()).not.toContain('Import Variants')
    expect(wrapper.text()).not.toContain('Select a case')
  })

  it('shows "Select a case" once cases have loaded (never flashes Import first)', async () => {
    const { wrapper, appState } = mountWithState(true)
    appState.setCaseCount(3)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Select a case')
    expect(wrapper.text()).not.toContain('Import Variants')
    expect(wrapper.find('.empty-state__cta').attributes('aria-busy')).toBe('false')
  })

  it('shows the import CTA when loading finished with zero cases', async () => {
    const { wrapper, appState } = mountWithState(false)
    appState.setCaseCount(0)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Import Variants')
  })

  it('falls back to the import CTA when loading the case list failed', async () => {
    const { wrapper, appState } = mountWithState(false)
    appState.markCasesLoadFailed()
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Import Variants')
  })

  it('names every format the import wizard accepts and promises no drag and drop', async () => {
    const { wrapper, appState } = mountWithState(false)
    appState.setCaseCount(0)
    await wrapper.vm.$nextTick()
    const text = wrapper.text()
    for (const extension of ['.vcf', '.vcf.gz', '.json', '.json.gz']) {
      expect(text).toContain(extension)
    }
    expect(text).toContain('ZIP')
    // No drop handler exists on the case view or app shell.
    expect(text.toLowerCase()).not.toContain('drag')
  })

  it('emits "import" when the CTA is clicked', async () => {
    const { wrapper, appState } = mountWithState(false)
    appState.setCaseCount(0)
    await wrapper.vm.$nextTick()
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('import')).toHaveLength(1)
  })
})
