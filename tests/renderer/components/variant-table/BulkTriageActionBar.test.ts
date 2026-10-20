import { describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { createPinia } from 'pinia'
import BulkTriageActionBar from '../../../../src/renderer/src/components/variant-table/BulkTriageActionBar.vue'

vi.mock('../../../../src/renderer/src/composables/useTags', () => ({
  useTags: () => ({
    loadTags: vi.fn().mockResolvedValue(undefined),
    getTags: () => [{ id: 5, name: 'Review', color: '#123456' }]
  })
}))

const vuetify = createVuetify({ components, directives })

async function click(testId: string): Promise<void> {
  const el = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  expect(el, testId).not.toBeNull()
  el!.click()
  await flushPromises()
}

describe('BulkTriageActionBar', () => {
  it('emits the payload of each bulk action', async () => {
    const wrapper = mount(BulkTriageActionBar, {
      props: { selectedCount: 3 },
      global: { plugins: [vuetify, createPinia()] },
      attachTo: document.body
    })

    await click('bulk-action-star')
    await click('bulk-action-unstar')
    await click('bulk-action-acmg')
    await click('bulk-acmg-option-lp')
    await click('bulk-action-acmg')
    await click('bulk-acmg-option-clear')
    await click('bulk-action-tag')
    await click('bulk-tag-option-5')

    expect(wrapper.emitted('apply')).toEqual([
      [{ starred: true }],
      [{ starred: false }],
      [{ acmg_classification: 'Likely pathogenic' }],
      [{ acmg_classification: null }],
      [{ tag_id: 5 }]
    ])
    wrapper.unmount()
  })

  it('renders nothing while no row is selected', () => {
    const wrapper = mount(BulkTriageActionBar, {
      props: { selectedCount: 0 },
      global: { plugins: [vuetify, createPinia()] }
    })
    expect(wrapper.find('[data-testid="bulk-triage-bar"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
