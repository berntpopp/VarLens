/** Labelled protein-view buttons beside the gene name: open a tab, or say why they cannot. */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import VariantIdentitySection from '../../../src/renderer/src/components/VariantIdentitySection.vue'
import {
  PROTEIN_VIEW_BUTTONS,
  PROTEIN_VIEW_COPY
} from '../../../src/renderer/src/config/proteinViewConfig'
import { CAPABILITY_FEATURES } from '../../../src/shared/ipc/capability-features'
import { installCapabilities } from '../helpers/capabilities'

const vuetify = createVuetify({ components, directives })
const variant = {
  chr: 'chr22',
  pos: 1,
  ref: 'A',
  alt: 'G',
  gene_symbol: 'THOC5',
  cdna: 'c.538A>G',
  aa_change: 'p.Met180Val'
}

function mountSection(over: Record<string, unknown> = {}, lookupsOn = true) {
  setActivePinia(createPinia())
  installCapabilities({
    runtime: lookupsOn ? 'desktop' : 'web',
    role: 'user',
    instanceFeatures: { proteinViewer: false }
  })
  return mount(VariantIdentitySection, {
    props: { variant: { ...variant, ...over } as never },
    global: { plugins: [vuetify] }
  })
}

const buttonsOf = (wrapper: ReturnType<typeof mountSection>) =>
  PROTEIN_VIEW_BUTTONS.map((b) => wrapper.findAll('button').find((el) => el.text() === b.label)!)

describe('VariantIdentitySection protein buttons', () => {
  it('each labelled button opens its tab', async () => {
    const wrapper = mountSection()
    for (const button of buttonsOf(wrapper)) await button.trigger('click')
    expect(wrapper.emitted('open-protein-view')).toEqual(PROTEIN_VIEW_BUTTONS.map((b) => [b.tab]))
  })

  it.each([
    ['lookups off', {}, false, CAPABILITY_FEATURES.proteinViewer.unavailableInWeb],
    [
      'no protein position',
      { aa_change: null, cdna: null },
      true,
      PROTEIN_VIEW_COPY.noProteinPosition
    ]
  ])('%s: stay visible, disabled, with the reason', (_n, over, lookupsOn, reason) => {
    const wrapper = mountSection(over, lookupsOn)
    for (const button of buttonsOf(wrapper)) {
      expect(button.attributes('disabled')).toBeDefined()
      expect(button.element.parentElement?.getAttribute('data-tooltip')).toBe(reason)
    }
  })
})
