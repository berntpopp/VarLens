/**
 * The presentational table cells are functional components that emit
 * Vuetify's icon/chip markup without mounting VIcon/VChip. These tests pin
 * the rendered DOM to what the Vuetify components produce, and the link
 * cells' click contract (emit url + event, no native listener fall-through).
 */
import { describe, it, expect } from 'vitest'
import { defineComponent, h, type VNode } from 'vue'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { aliases, mdi } from 'vuetify/iconsets/mdi-svg'
import { mdiOpenInNew } from '@mdi/js'
import {
  AlleleCell,
  CaddScoreCell,
  CellChip,
  CellIcon,
  ClinVarCell,
  ConsequenceCell,
  EmptyPlaceholder,
  ExternalLinkCell,
  FrequencyCell,
  GeneSymbolCell,
  PositionCell
} from '../../../../src/renderer/src/components/table-cells'
import {
  colorBinding,
  isCssColor
} from '../../../../src/renderer/src/components/table-cells/cell-vnodes'

// Same icon set and global density as the app (plugins/vuetify.ts) so markup matches.
const vuetify = createVuetify({
  components,
  directives,
  icons: { defaultSet: 'mdi', aliases, sets: { mdi } },
  defaults: { global: { density: 'compact' } }
})
const global = { plugins: [vuetify] }

/** Classes of an element, minus the theme class Vuetify adds per component. */
function classesOf(element: Element): string[] {
  return [...element.classList].filter((c) => !c.startsWith('v-theme--')).sort()
}

describe('CellIcon', () => {
  it('renders the same element tree and classes as <v-icon> with an mdi-svg path', () => {
    const fast = mount(CellIcon, {
      props: { icon: mdiOpenInNew, size: 'x-small', color: 'muted' }
    })
    const real = mount(components.VIcon, {
      props: { icon: mdiOpenInNew, size: 'x-small', color: 'muted' },
      global
    })
    expect(classesOf(fast.element)).toEqual(classesOf(real.element))
    expect(fast.find('svg').attributes()).toEqual(real.find('svg').attributes())
    expect(fast.find('path').attributes('d')).toBe(mdiOpenInNew)
    expect(fast.attributes('aria-hidden')).toBe('true')
  })

  it('uses inline styles for CSS colours, like Vuetify', () => {
    const fast = mount(CellIcon, { props: { icon: mdiOpenInNew, color: '#C62828' } })
    expect(fast.attributes('style')).toContain('color: #C62828')
    expect(fast.classes().some((c) => c.startsWith('text-'))).toBe(false)
  })
})

describe('CellChip', () => {
  it.each([
    { color: 'success', variant: 'tonal', size: 'small', label: true },
    { color: 'primary', variant: 'flat', size: 'x-small', label: false }
  ] as const)('matches <v-chip> classes for %o', (props) => {
    const fast = mount(CellChip, { props, slots: { default: () => 'Benign' } })
    const real = mount(components.VChip, { props, slots: { default: () => 'Benign' }, global })
    expect(classesOf(fast.element)).toEqual(classesOf(real.element))
    expect(fast.find('.v-chip__content').text()).toBe('Benign')
    expect(fast.find('.v-chip__underlay').exists()).toBe(true)
  })

  it('maps colours the way Vuetify does', () => {
    expect(isCssColor('#fff')).toBe(true)
    expect(isCssColor('rgb(1,2,3)')).toBe(true)
    expect(isCssColor('primary')).toBe(false)
    expect(isCssColor(null)).toBe(false)
    expect(colorBinding('text', 'error')).toEqual({ class: 'text-error', style: undefined })
    expect(colorBinding('background', 'primary').class).toBe('bg-primary')
    expect(colorBinding('text', '')).toEqual({ class: undefined, style: undefined })
  })
})

describe('link cells', () => {
  function host(render: (onClick: (url: string) => void) => VNode) {
    const clicks: string[] = []
    const wrapper = mount(defineComponent({ render: () => render((url) => clicks.push(url)) }), {
      global
    })
    return { wrapper, clicks }
  }

  it('ExternalLinkCell emits the url once and renders the external-link icon', async () => {
    const { wrapper, clicks } = host((onClick) =>
      h(ExternalLinkCell, { url: 'https://example.org', label: 'OMIM', onClick })
    )
    expect(wrapper.text()).toBe('OMIM')
    expect(wrapper.find('i.external-link__icon svg').exists()).toBe(true)
    await wrapper.find('.external-link').trigger('click')
    expect(clicks).toEqual(['https://example.org'])
  })

  it('ExternalLinkCell renders a placeholder without a url', () => {
    const { wrapper } = host(() => h(ExternalLinkCell, { url: null }))
    expect(wrapper.text()).toBe('--')
    expect(wrapper.find('.external-link').exists()).toBe(false)
  })

  it('PositionCell formats with thousands separators, linked or not', async () => {
    const linked = host((onClick) =>
      h(PositionCell, { position: 1234567, url: 'https://x.test', onClick })
    )
    expect(linked.wrapper.text()).toBe('1,234,567')
    await linked.wrapper.find('.external-link').trigger('click')
    expect(linked.clicks).toEqual(['https://x.test'])
    const plain = host(() => h(PositionCell, { position: 42 }))
    expect(plain.wrapper.find('.genomic-coordinate').text()).toBe('42')
    expect(plain.wrapper.find('.external-link').exists()).toBe(false)
  })

  it('GeneSymbolCell links only when both value and url are present', () => {
    const linked = host(() => h(GeneSymbolCell, { value: 'TTN', linkUrl: 'u' }))
    expect(linked.wrapper.find('.external-link').exists()).toBe(true)
    const unlinked = host(() => h(GeneSymbolCell, { value: 'TTN', linkUrl: null }))
    expect(unlinked.wrapper.text()).toBe('TTN')
    expect(host(() => h(GeneSymbolCell, { value: null })).wrapper.text()).toBe('--')
  })

  it('ClinVarCell renders a labelled chip with a delegated tooltip', async () => {
    const { wrapper, clicks } = host((onClick) =>
      h(ClinVarCell, { significance: 'Likely_pathogenic', url: 'https://cv', onClick })
    )
    const chip = wrapper.find('.v-chip')
    expect(chip.text()).toBe('Likely pathogenic')
    expect(chip.classes()).toContain('v-chip--label')
    expect(wrapper.find('.external-link').attributes('data-tooltip')).toBe('Likely_pathogenic')
    await wrapper.find('.external-link').trigger('click')
    expect(clicks).toEqual(['https://cv'])
    const unlinked = host(() => h(ClinVarCell, { significance: 'Benign' }))
    expect(unlinked.wrapper.find('.v-chip').attributes('data-tooltip')).toBe('Benign')
    expect(host(() => h(ClinVarCell, { significance: null })).wrapper.text()).toBe('--')
  })
})

describe('value cells', () => {
  it('AlleleCell truncates long alleles and keeps the full value as tooltip', () => {
    const long = 'A'.repeat(30)
    const wrapper = mount(AlleleCell, { props: { allele: long } })
    expect(wrapper.text()).toBe(`${'A'.repeat(20)}...`)
    expect(wrapper.attributes('data-tooltip')).toBe(long)
    expect(mount(AlleleCell, { props: { allele: 'ACGT' } }).text()).toBe('ACGT')
  })

  it('FrequencyCell, CaddScoreCell and ConsequenceCell format values', () => {
    expect(mount(FrequencyCell, { props: { frequency: 0.00012 } }).text()).toBe('1.2e-4')
    expect(mount(FrequencyCell, { props: { frequency: null } }).text()).toBe('--')
    expect(mount(CaddScoreCell, { props: { score: 23.456 } }).text()).toBe('23.5')
    const chip = mount(CaddScoreCell, { props: { score: 30, asChip: true } })
    expect(chip.find('.v-chip').exists()).toBe(true)
    expect(mount(CaddScoreCell, { props: { score: null } }).text()).toBe('--')
    const consequence = mount(ConsequenceCell, { props: { consequence: 'stop_gained' } })
    expect(consequence.text()).toBe('stop gained')
    expect(consequence.attributes('data-tooltip')).toBe('stop_gained')
    expect(mount(EmptyPlaceholder).text()).toBe('--')
  })
})
