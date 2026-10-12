import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import VariantIdentitySection from '../../../src/renderer/src/components/VariantIdentitySection.vue'
import { installCapabilities } from '../helpers/capabilities'
import { NO_GENE_LABEL } from '../../../src/renderer/src/config/displayConfig'
import type { Variant } from '../../../src/shared/types/api'

const vuetify = createVuetify({ components, directives })

// The section's protein-view buttons read the capability store.
beforeEach(() => installCapabilities())

function render(variant: Record<string, unknown>) {
  const base = { chr: '1', pos: 100, ref: 'A', alt: 'G', gene_symbol: null, cdna: null }
  return mount(VariantIdentitySection, {
    props: { variant: { ...base, aa_change: null, transcript: null, ...variant } as Variant },
    global: { plugins: [vuetify] }
  })
}

describe('VariantIdentitySection', () => {
  it('shows a full VEP HGVS value once instead of prefixing the transcript again', () => {
    const text = render({
      transcript: 'ENST00000361682',
      cdna: 'ENST00000361682.4:c.186C>T',
      aa_change: 'ENSP00000354346.4:p.Ala62%3D'
    })
      .find('.hgvs-notation')
      .text()
    expect(text).toBe('ENST00000361682.4:c.186C>T ENSP00000354346.4:p.Ala62=')
  })

  it('titles an STR call by its repeat id and falls back to the configured label', () => {
    expect(render({ _str_repeat_id: 'FMR1_CGG' }).find('h3').text()).toBe('FMR1_CGG')
    expect(render({}).find('h3').text()).toBe(NO_GENE_LABEL)
  })
})
