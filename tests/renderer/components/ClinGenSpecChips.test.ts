/** A gene with a ClinGen VCEP specification gets a chip that opens it (#201). */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import ClinGenSpecChips from '../../../src/renderer/src/components/ClinGenSpecChips.vue'

const vuetify = createVuetify({ components, directives })
const openExternal = vi.fn(() => Promise.resolve({ success: true }))

afterEach(() => {
  openExternal.mockClear()
  delete (window as { api?: unknown }).api
})

function render(gene: string | null) {
  ;(window as { api?: unknown }).api = { shell: { openExternal } }
  return mount(ClinGenSpecChips, { props: { gene }, global: { plugins: [vuetify] } })
}

describe('ClinGenSpecChips', () => {
  it('links the VCEP specification of a gene, with panel, version and snapshot date', async () => {
    const chip = render('MYH7').find('[data-testid="clingen-spec"]')
    expect(chip.text()).toBe('ClinGen VCEP')
    expect(chip.attributes('data-tooltip')).toMatch(
      /Cardiomyopathy Variant Curation Expert Panel v\d.*\d{4}-\d{2}-\d{2}/
    )
    await chip.trigger('click')
    expect(openExternal).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/cspec\.genome\.network\/.*GN002$/)
    )
  })

  it('names each spec when a gene has several', () => {
    const labels = render('RYR1')
      .findAll('[data-testid="clingen-spec"]')
      .map((c) => c.text())
    expect(labels.length).toBeGreaterThan(1)
    expect(labels[0]).toMatch(/^ClinGen VCEP GN\d+$/)
  })

  it('renders nothing for a gene without one', () => {
    expect(render('ZNRF3').find('[data-testid="clingen-spec"]').exists()).toBe(false)
    expect(render(null).find('[data-testid="clingen-spec"]').exists()).toBe(false)
  })
})
