/** The tooltip labels consequences like the variant table does (#509). */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import ProteinTooltip from '../../../../src/renderer/src/components/protein/ProteinTooltip.vue'
import type { TooltipData } from '../../../../src/renderer/src/composables/useLollipopPlot'

describe('ProteinTooltip', () => {
  it('shows the shared consequence label', () => {
    const data = {
      visible: true,
      type: 'variant',
      x: 0,
      y: 0,
      variants: [
        {
          proteinPosition: 12,
          aaChange: 'p.Gly12Asp',
          color: '#000',
          consequence: 'missense_variant',
          gnomadAf: null,
          cadd: null
        }
      ]
    } as unknown as TooltipData
    const wrapper = mount(ProteinTooltip, {
      props: { data },
      global: { stubs: { teleport: true } }
    })

    expect(wrapper.text()).toContain('Missense')
    expect(wrapper.text()).not.toContain('missense variant')
    wrapper.unmount()
  })
})
