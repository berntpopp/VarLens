import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import GeneBurdenView from '../../../../src/renderer/src/components/association/GeneBurdenView.vue'
import { createVuetify } from 'vuetify'
import { nextTick } from 'vue'

const vuetify = createVuetify()

describe('GeneBurdenView', () => {
  it('displays warning when non_autosomal_variants > 0', async () => {
    const wrapper = mount(GeneBurdenView as any, {
      global: {
        plugins: [createPinia(), vuetify]
      }
    })

    // Set the results directly via internal ref since useAssociation returns them
    wrapper.vm.results = {
      results: [],
      warnings: [],
      elapsed_ms: 100,
      primary_test: 'fisher',
      sites_excluded: 0,
      non_autosomal_variants: 5
    }

    await nextTick()
    expect(wrapper.text()).toContain('5 non-autosomal variants were excluded from the analysis')
  })
})
