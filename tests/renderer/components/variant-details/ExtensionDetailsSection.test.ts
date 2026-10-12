/** CNV/SV details show build, coordinates, type, length and caller together (#539). */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import ExtensionDetailsSection from '../../../../src/renderer/src/components/variant-details/ExtensionDetailsSection.vue'

const vuetify = createVuetify({ components, directives })

function render(variant: Record<string, unknown>, genomeBuild: string | null) {
  const wrapper = mount(ExtensionDetailsSection, {
    props: { variant, genomeBuild },
    global: { plugins: [vuetify] }
  })
  const text = (id: string): string => wrapper.find(`[data-testid="${id}"]`).text()
  return { wrapper, text }
}

describe('ExtensionDetailsSection call context', () => {
  it('shows a CNV deletion with its interval and build', () => {
    const { text, wrapper } = render(
      {
        chr: '7',
        pos: 117_500_000,
        alt: '<DEL>',
        variant_type: 'cnv',
        sv_type: 'DEL',
        end_pos: 117_600_000,
        sv_length: -100_000,
        caller: 'CNVkit',
        _cnv_copy_number: 1
      },
      'GRCh38'
    )
    expect(text('call-build')).toBe('GRCh38')
    expect(text('call-coordinates')).toBe('7:117,500,000-117,600,000')
    expect(text('call-length')).toBe('100.00 kb') // DEL is shown by the type
    expect(text('call-caller')).toBe('CNVkit')
    expect(wrapper.find('[data-testid="missing-evidence"]').exists()).toBe(false)
  })

  it('shows an SV duplication with an unknown build and explicit missing evidence', () => {
    const { text } = render(
      {
        chr: 'X',
        pos: 1000,
        alt: '<DUP>',
        variant_type: 'sv',
        sv_type: 'DUP',
        end_pos: 6000,
        sv_length: 5000,
        caller: null
      },
      null
    )
    expect(text('call-build')).toBe('Unknown build')
    expect(text('call-coordinates')).toBe('X:1,000-6,000')
    expect(text('call-length')).toBe('5.00 kb')
    expect(text('call-caller')).toBe('Not reported')
    expect(text('missing-evidence')).toContain('No read-support evidence')
  })

  it('shows a breakend as a position with its mate, without a length', () => {
    const { text } = render(
      {
        chr: '2',
        pos: 321_682,
        alt: 'N[13:123456[',
        variant_type: 'sv',
        sv_type: 'BND',
        end_pos: 321_682,
        caller: 'Manta',
        _sv_support: 12
      },
      'GRCh37'
    )
    expect(text('call-build')).toBe('GRCh37')
    expect(text('call-coordinates')).toBe('2:321,682 (breakend, mate N[13:123456[)')
    expect(text('call-length')).toBe('Not applicable (breakend)')
  })

  it('renders nothing for an SNV', () => {
    const { wrapper } = render({ chr: '1', pos: 5, variant_type: 'snv' }, 'GRCh38')
    expect(wrapper.find('[data-testid="call-context"]').exists()).toBe(false)
  })
})
