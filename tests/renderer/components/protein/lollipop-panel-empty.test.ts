/** The lollipop says why it is empty when the protein length is unknown (L-01). */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import LollipopPlotPanel from '../../../../src/renderer/src/components/protein/LollipopPlotPanel.vue'
import { PROTEIN_VIEW_COPY } from '../../../../src/renderer/src/config/uiCopyConfig'
import { installCapabilities } from '../../helpers/capabilities'

const vuetify = createVuetify({ components, directives })

function render(proteinLength: number) {
  setActivePinia(createPinia())
  installCapabilities({ runtime: 'desktop', role: 'user' })
  return mount(LollipopPlotPanel, {
    props: {
      proteinLength,
      domains: [],
      variants: [],
      geneSymbol: 'NAT2',
      showCaseVariants: false,
      caseVariantsLoading: false,
      hasCaseId: false,
      clinvarVariants: [],
      clinvarLoading: false
    },
    global: {
      plugins: [vuetify],
      stubs: {
        TrackView: { name: 'TrackView', template: '<div class="plot-stub" />' },
        LollipopToolbar: true,
        LollipopLegend: true
      }
    }
  })
}

describe('LollipopPlotPanel without a protein length', () => {
  it.each([
    [0, false, true],
    [683, true, false]
  ])('length %i: plot %s, note %s', (length, plot, note) => {
    const wrapper = render(length)
    expect(wrapper.find('.plot-stub').exists()).toBe(plot)
    expect(wrapper.text().includes(PROTEIN_VIEW_COPY.lengthUnknown)).toBe(note)
  })
})
