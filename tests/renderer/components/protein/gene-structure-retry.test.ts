/** A failed Ensembl lookup says what failed and offers Retry. */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import GeneStructurePanel from '../../../../src/renderer/src/components/protein/GeneStructurePanel.vue'
import { PLOT_COPY } from '../../../../src/renderer/src/config/proteinPlotConfig'

const vuetify = createVuetify({ components, directives })

describe('GeneStructurePanel error state', () => {
  it('names the failed lookup and its reason, and Retry asks to load again', async () => {
    setActivePinia(createPinia())
    const wrapper = mount(GeneStructurePanel, {
      props: {
        geneStructure: null,
        loading: false,
        error: 'Ensembl did not answer within 25 s (2 attempts)',
        variant: null,
        geneSymbol: 'TTN',
        clinvarVariants: [],
        clinvarLoading: false
      },
      global: { plugins: [vuetify], stubs: { TrackView: true } }
    })
    expect(wrapper.text()).toContain(PLOT_COPY.geneStructureUnavailable)
    expect(wrapper.text()).toContain('Ensembl did not answer within 25 s (2 attempts)')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === PLOT_COPY.retry)!
      .trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })
})
