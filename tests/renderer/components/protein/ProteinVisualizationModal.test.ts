/** The protein modal opens on the requested tab and plots the cohort's carriers. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import ProteinVisualizationModal from '../../../../src/renderer/src/components/protein/ProteinVisualizationModal.vue'
import { createQueryPinia, queryPlugins } from '../../helpers/with-queries'
import type { LollipopVariant } from '../../../../src/shared/types/protein'

vi.mock('../../../../src/renderer/src/services/LogService', () => ({
  logService: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const vuetify = createVuetify({ components, directives })
const selected = {
  chr: 'chr22',
  pos: 100,
  ref: 'A',
  alt: 'G',
  gene_symbol: 'THOC5',
  aa_change: 'p.Met180Val',
  consequence: 'MODERATE',
  carrier_count: 3,
  genome_build: 'GRCh38'
}

function mountModal(props: Record<string, unknown>) {
  return shallowMount(ProteinVisualizationModal, {
    props: { modelValue: true, variant: selected as never, caseId: null, ...props },
    global: { plugins: [vuetify, ...queryPlugins(createQueryPinia())], renderStubDefaultSlot: true }
  })
}

describe('ProteinVisualizationModal', () => {
  beforeEach(() => {
    Object.assign(window, {
      api: {
        protein: {
          getMapping: vi.fn().mockResolvedValue({
            success: true,
            mapping: { uniprotAccession: 'Q13769', proteinName: 'THOC5', proteinLength: 683 }
          }),
          getDomains: vi.fn().mockResolvedValue({ success: true, domains: [], proteinLength: 683 }),
          getStructure: vi.fn().mockResolvedValue({ success: true, structure: null }),
          getGeneStructure: vi.fn().mockResolvedValue({ success: true, geneStructure: null })
        },
        gnomad: { getClinVarVariants: vi.fn().mockResolvedValue({ success: true, variants: [] }) }
      }
    })
  })
  afterEach(() => delete (window as { api?: unknown }).api)

  it('opens on the requested tab', async () => {
    const wrapper = mountModal({ mode: 'case', initialTab: '3d' })
    await flushPromises()
    expect(wrapper.findComponent({ name: 'ProteinStructure3DPanel' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'LollipopPlotPanel' }).exists()).toBe(false)
  })

  it('cohort: plots every carrier row of the gene, sized by carriers', async () => {
    const loadCohortCarriers = vi
      .fn()
      .mockResolvedValue([
        selected,
        { ...selected, pos: 200, aa_change: 'p.Arg300Gln', carrier_count: 5 }
      ])
    const wrapper = mountModal({ mode: 'cohort', loadCohortCarriers })
    await flushPromises()

    expect(loadCohortCarriers).toHaveBeenCalledWith('THOC5')
    const variants = wrapper
      .findComponent({ name: 'LollipopPlotPanel' })
      .props('variants') as LollipopVariant[]
    expect(variants.map((v) => [v.proteinPosition, v.carrierCount, v.highlighted])).toEqual([
      [180, 3, true],
      [300, 5, false]
    ])
  })
})
