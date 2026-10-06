import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import ExternalLinkCell from '../../../../src/renderer/src/components/table-cells/ExternalLinkCell.vue'
import ClinVarCell from '../../../../src/renderer/src/components/table-cells/ClinVarCell.vue'
import PositionCell from '../../../../src/renderer/src/components/table-cells/PositionCell.vue'

const vuetify = createVuetify({ components })
const URL_ = 'https://www.omim.org/entry/612555'

describe('link cells are real, keyboard-reachable anchors', () => {
  it('ExternalLinkCell renders <a href> with a descriptive accessible name', () => {
    const w = mount(ExternalLinkCell, {
      props: { url: URL_, label: '612555', ariaLabel: 'OMIM 612555 (opens in a new tab)' },
      global: { plugins: [vuetify] }
    })
    const a = w.get('a')
    expect(a.attributes('href')).toBe(URL_)
    expect(a.attributes('rel')).toContain('noopener')
    expect(a.attributes('aria-label')).toBe('OMIM 612555 (opens in a new tab)')
  })

  it('click is intercepted and re-emitted (Electron opens via shell.openExternal)', async () => {
    const w = mount(ExternalLinkCell, {
      props: { url: URL_, label: 'View' },
      global: { plugins: [vuetify] }
    })
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    w.get('a').element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(w.emitted('click')?.[0]?.[0]).toBe(URL_)
    expect(w.get('a').attributes('aria-label')).toBe('View (opens in a new tab)')
  })

  it('ClinVarCell links with a humanised significance in the accessible name', () => {
    const w = mount(ClinVarCell, {
      props: { significance: 'Likely_pathogenic', url: 'https://www.ncbi.nlm.nih.gov/clinvar/' },
      global: { plugins: [vuetify] }
    })
    expect(w.get('a').attributes('aria-label')).toBe(
      'ClinVar: Likely pathogenic (opens in a new tab)'
    )
  })

  it('PositionCell renders a link only when a URL is configured', () => {
    const linked = mount(PositionCell, {
      props: { position: 1234567, url: 'https://genome.ucsc.edu/' },
      global: { plugins: [vuetify] }
    })
    expect(linked.find('a').exists()).toBe(true)
    const plain = mount(PositionCell, {
      props: { position: 1234567, url: null },
      global: { plugins: [vuetify] }
    })
    expect(plain.find('a').exists()).toBe(false)
  })
})
