/** CNV/SV details show build, coordinates, type, length and caller together (#539). */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import ExtensionDetailsSection from '../../../../src/renderer/src/components/variant-details/ExtensionDetailsSection.vue'
import { COHORT_CALL_EVIDENCE_NOTE } from '../../../../src/renderer/src/config/uiCopyConfig'

const vuetify = createVuetify({ components, directives })

function render(variant: Record<string, unknown>, genomeBuild: string | null, summaryOnly = false) {
  const wrapper = mount(ExtensionDetailsSection, {
    props: { variant, genomeBuild, summaryOnly },
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

describe('ExtensionDetailsSection on a cohort row (summaryOnly, #539)', () => {
  const cohortDel = {
    chr: '7',
    pos: 1000,
    alt: '<DEL>',
    variant_type: 'sv',
    sv_type: 'DEL',
    end_pos: 5000,
    sv_length: 4000
  }

  it('shows build, interval, type and length and points to the carriers for evidence', () => {
    const { text, wrapper } = render(cohortDel, 'GRCh38', true)
    expect(text('call-build')).toBe('GRCh38')
    expect(text('call-coordinates')).toBe('7:1,000-5,000')
    expect(text('call-length')).toBe('4.00 kb')
    expect(text('carrier-evidence-note')).toBe(COHORT_CALL_EVIDENCE_NOTE)
    // Summary rows carry no per-call evidence: nothing may read as "Imprecise" or "missing".
    expect(wrapper.find('[data-testid="call-caller"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="missing-evidence"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Imprecise')
  })

  it('renders nothing for a cohort STR row (no per-row repeat data)', () => {
    const { wrapper } = render({ chr: '4', pos: 1, variant_type: 'str' }, 'GRCh38', true)
    expect(wrapper.find('.extension-section').exists()).toBe(false)
  })
})
