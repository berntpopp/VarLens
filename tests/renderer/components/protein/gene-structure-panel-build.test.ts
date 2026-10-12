/** The gene-structure panel draws only same-build variants and says so otherwise (#539). */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import GeneStructurePanel from '../../../../src/renderer/src/components/protein/GeneStructurePanel.vue'

const vuetify = createVuetify({ components, directives })

const geneStructure = {
  geneSymbol: 'CFTR',
  chromosome: '7',
  start: 100,
  end: 1000,
  strand: 1 as const,
  transcriptId: 'CFTR-201',
  exons: [{ start: 100, end: 200, rank: 1 }]
}
const variant = { chr: '7', pos: 150, end: 450, ref: 'N', alt: '<DEL>', label: 'DEL', color: '' }

function render(variantBuild: string | null) {
  return mount(GeneStructurePanel, {
    props: {
      geneStructure,
      loading: false,
      error: null,
      variant,
      variantBuild,
      geneSymbol: 'CFTR',
      clinvarVariants: [],
      clinvarLoading: false
    },
    global: {
      plugins: [vuetify],
      stubs: {
        TrackView: {
          name: 'TrackView',
          props: ['deps'],
          template: '<div />'
        }
      }
    }
  })
}

describe('GeneStructurePanel genome build', () => {
  it('draws a GRCh38 interval without a warning', () => {
    const wrapper = render('GRCh38')
    const model = wrapper.findComponent({ name: 'TrackView' }).props('deps')
    expect(model.anchorVariant).toEqual(variant)
    expect(model.axisNote).toBe(null)
    expect(wrapper.find('[data-testid="gene-structure-build-note"]').exists()).toBe(false)
  })

  it('does not draw a GRCh37 variant on the GRCh38 gene model', () => {
    const wrapper = render('GRCh37')
    expect(wrapper.findComponent({ name: 'TrackView' }).props('deps').anchorVariant).toBe(null)
    expect(wrapper.find('[data-testid="gene-structure-build-note"]').text()).toContain(
      'Variant is GRCh37'
    )
  })

  it('draws a variant of unknown build but says the build is unknown', () => {
    const wrapper = render(null)
    const model = wrapper.findComponent({ name: 'TrackView' }).props('deps')
    expect(model.anchorVariant).toEqual(variant)
    expect(model.axisNote).toBe('Variant genome build unknown')
  })
})
