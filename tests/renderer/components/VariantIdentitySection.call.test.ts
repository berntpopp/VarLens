/** The panel shows ClinVar and the per-sample call quality from the row (P-01). */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import VariantIdentitySection from '../../../src/renderer/src/components/VariantIdentitySection.vue'

const vuetify = createVuetify({ components, directives })

const base = {
  chr: 'chr22',
  pos: 29001799,
  ref: 'T',
  alt: 'G',
  gene_symbol: 'ZNRF3',
  cdna: null,
  aa_change: null
}

const callLine = (w: ReturnType<typeof render>) =>
  w
    .find('[data-testid="call-line"]')
    .text()
    .replace(/\u00a0/g, ' ')

function render(variant: Record<string, unknown>) {
  return mount(VariantIdentitySection, {
    props: { variant: variant as never },
    global: { plugins: [vuetify] }
  })
}

describe('VariantIdentitySection call line', () => {
  it('shows humanised ClinVar and GT/DP/GQ/AB/FILTER for a case row', () => {
    const wrapper = render({
      ...base,
      transcript: null,
      clinvar: 'Uncertain_significance',
      gt_num: '0|1',
      dp: 887,
      gq: 546,
      ab: 0.4540059347181009,
      filter: 'PASS'
    })
    expect(wrapper.text()).toContain('Uncertain significance')
    expect(callLine(wrapper)).toBe('GT 0|1 · DP 887 · GQ 546 · AB 0.45 · FILTER PASS')
  })

  it('skips missing call fields', () => {
    const wrapper = render({
      ...base,
      transcript: null,
      clinvar: null,
      gt_num: '1/1',
      dp: null,
      gq: null,
      ab: null,
      filter: null
    })
    expect(callLine(wrapper)).toBe('GT 1/1')
  })

  it('shows ClinVar but no call line for a cohort row', () => {
    const wrapper = render({ ...base, clinvar: 'Pathogenic' })
    expect(wrapper.text()).toContain('Pathogenic')
    expect(wrapper.find('[data-testid="call-line"]').exists()).toBe(false)
  })
})
