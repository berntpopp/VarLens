/** The details-panel mini lollipop: the entry to the protein view, in every state. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { setActivePinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import ProteinPreviewStrip from '../../../../src/renderer/src/components/protein/ProteinPreviewStrip.vue'
import { PROTEIN_VIEW_COPY } from '../../../../src/renderer/src/config/proteinViewConfig'
import { createQueryPinia, queryPlugins } from '../../helpers/with-queries'
import { installCapabilities } from '../../helpers/capabilities'

vi.mock('../../../../src/renderer/src/services/LogService', () => ({
  logService: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const vuetify = createVuetify({ components, directives })
const variant = {
  chr: 'chr22',
  pos: 1,
  ref: 'A',
  alt: 'G',
  gene_symbol: 'THOC5',
  aa_change: 'p.Met180Val',
  consequence: 'MODERATE'
}
const getMapping = vi.fn()
const getDomains = vi.fn()

function mountStrip(over: Record<string, unknown> = {}, web = false) {
  const pinia = createQueryPinia()
  if (web) {
    setActivePinia(pinia)
    installCapabilities({
      runtime: 'web',
      role: 'user',
      instanceFeatures: { proteinViewer: false }
    })
  }
  return mount(ProteinPreviewStrip, {
    props: { variant: { ...variant, ...over } as never },
    global: { plugins: [vuetify, ...queryPlugins(pinia)] }
  })
}

describe('ProteinPreviewStrip', () => {
  beforeEach(() => {
    getMapping.mockReset().mockResolvedValue({
      success: true,
      mapping: { uniprotAccession: 'Q13769', proteinName: 'THOC5', proteinLength: 683 }
    })
    getDomains.mockReset().mockResolvedValue({
      success: true,
      proteinLength: 683,
      domains: [{ accession: 'IPR1', name: 'THOC5 domain', type: 'domain', start: 150, end: 200 }]
    })
    Object.assign(window, { api: { protein: { getMapping, getDomains } } })
  })
  afterEach(() => delete (window as { api?: unknown }).api)

  it('draws the variant on the protein and opens the lollipop on click', async () => {
    const wrapper = mountStrip()
    await flushPromises()

    const plot = wrapper.get('[data-testid="protein-strip-plot"]')
    expect(plot.attributes('aria-label')).toContain('Variant at p.180 of 683 in THOC5 domain')
    expect(wrapper.text()).toContain('p.180 / 683 aa')
    expect(wrapper.findAll('[data-testid="protein-strip-domain"]')).toHaveLength(1)
    await plot.trigger('click')
    expect(wrapper.emitted('open')).toEqual([['lollipop']])
  })

  it('the Gene link opens the gene structure tab', async () => {
    const wrapper = mountStrip()
    await flushPromises()
    await wrapper.get('[data-testid="protein-strip-gene"]').trigger('click')
    expect(wrapper.emitted('open')).toEqual([['gene-structure']])
  })

  it('reserves its height while loading (no layout shift)', () => {
    getMapping.mockReturnValue(new Promise(() => undefined))
    const wrapper = mountStrip()
    expect(wrapper.get('[data-testid="protein-strip"]').classes()).toContain('protein-strip')
    expect(wrapper.find('[data-testid="protein-strip-loading"]').exists()).toBe(true)
  })

  it('a failed lookup is one muted line with the reason', async () => {
    getMapping.mockResolvedValue({ success: false, error: 'Gene not found in UniProt' })
    const wrapper = mountStrip()
    await flushPromises()
    expect(wrapper.text()).toContain(PROTEIN_VIEW_COPY.loadFailed)
    expect(wrapper.text()).toContain('Gene not found in UniProt')
  })

  it('web with lookups off: says how to enable them and never calls the API', async () => {
    const wrapper = mountStrip({}, true)
    await flushPromises()
    expect(wrapper.text()).toContain(PROTEIN_VIEW_COPY.lookupsOff)
    expect(getMapping).not.toHaveBeenCalled()
  })

  it('no protein position: hidden', () => {
    const wrapper = mountStrip({ aa_change: null })
    expect(wrapper.find('[data-testid="protein-strip"]').exists()).toBe(false)
    expect(getMapping).not.toHaveBeenCalled()
  })
})
