import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import ActivityLogPanel from '../../../src/renderer/src/components/ActivityLogPanel.vue'

const vuetify = createVuetify({ components, directives })

const entry = (id: number, key: string, timestamp: number) => ({
  id,
  timestamp,
  action_type: 'acmg_classify',
  entity_type: 'variant_annotation',
  entity_key: key,
  old_value: null,
  new_value: JSON.stringify({ acmg_classification: `Class ${id}` }),
  user_name: null
})

describe('ActivityLogPanel', () => {
  it('shows the entries of every key, newest last (#577: build key plus legacy key)', async () => {
    setActivePinia(createPinia())
    const getByEntity = vi.fn(async (key: string) =>
      key === '1:5:A:G' ? [entry(1, key, 10)] : [entry(2, key, 20)]
    )
    ;(window as unknown as { api: unknown }).api = { audit: { getByEntity } }
    const wrapper = mount(ActivityLogPanel, {
      props: { entityKeys: ['1:5:A:G@GRCh38', '1:5:A:G'] },
      global: { plugins: [vuetify] }
    })
    await flushPromises()
    expect(getByEntity).toHaveBeenCalledWith('1:5:A:G@GRCh38')
    expect(getByEntity).toHaveBeenCalledWith('1:5:A:G')
    const text = wrapper.text()
    expect(text.indexOf('Class 1')).toBeGreaterThan(-1)
    expect(text.indexOf('Class 1')).toBeLessThan(text.indexOf('Class 2'))
  })
})
