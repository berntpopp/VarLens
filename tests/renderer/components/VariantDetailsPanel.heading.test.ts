import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import VariantDetailsPanel from '../../../src/renderer/src/components/VariantDetailsPanel.vue'
import { installCapabilities } from '../helpers/capabilities'

const vuetify = createVuetify({ components, directives })

const STUBS = Object.fromEntries(
  [
    'ExternalLinksSection',
    'CommentsSection',
    'TagsSection',
    'AcmgClassificationPanel',
    'ActivityLogPanel',
    'ProteinVisualizationModal',
    'ProteinViewUnavailableDialog',
    'ExtensionDetailsSection'
  ].map((name) => [name, { name, template: '<div />' }])
)

const variant = (pos: number, gene: string, aa: string | null, cdna: string | null) => ({
  chr: '1',
  pos,
  ref: 'G',
  alt: 'A',
  gene_symbol: gene,
  aa_change: aa,
  cdna,
  genome_build: 'GRCh38'
})

function mountPanel(v: ReturnType<typeof variant>) {
  setActivePinia(createPinia())
  installCapabilities({ runtime: 'desktop', role: 'user' })
  return shallowMount(VariantDetailsPanel, {
    props: { open: true, variant: v as never, caseId: null, mode: 'cohort' },
    global: { plugins: [vuetify], renderStubDefaultSlot: true, stubs: STUBS }
  })
}

describe('VariantDetailsPanel heading and scroll', () => {
  it.each([
    [variant(1, 'LMNA', 'p.Arg453Trp', 'c.1357C>T'), 'LMNA · p.Arg453Trp'],
    [variant(1, 'LMNA', null, 'c.1357C>T'), 'LMNA · c.1357C>T'],
    [variant(1, 'LMNA', null, null), 'LMNA']
  ])('names the variant in the heading (%#)', (v, expected) => {
    const wrapper = mountPanel(v)
    expect(wrapper.find('h2').text().replace(/\s+/g, ' ')).toBe(expected)
  })

  it('scrolls back to the top when another variant is shown', async () => {
    const wrapper = mountPanel(variant(1, 'LMNA', null, null))
    const scroller = wrapper.find('[data-testid="variant-details-scroll"]').element as HTMLElement
    scroller.scrollTop = 400
    await wrapper.setProps({ variant: variant(2, 'SCN1A', null, null) as never })
    await nextTick()
    expect(scroller.scrollTop).toBe(0)
  })
})
