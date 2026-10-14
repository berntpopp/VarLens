import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import type { HpoDataStatus } from '../../../../src/shared/types/hpo-data'

vi.mock('../../../../src/renderer/src/stores/capabilityStore', () => ({
  useCapabilityStore: () => ({ canUse: () => true })
}))

import HpoDataRow from '../../../../src/renderer/src/components/panels/HpoDataRow.vue'
import { phenotypeChange } from '../../../../src/renderer/src/composables/phenotypeChanges'

const outdated: HpoDataStatus = {
  installed: true,
  needsUpdate: true,
  version: 'v2026-09-01',
  builtAt: null,
  termCount: 1,
  geneCount: 1
}

describe('HpoDataRow', () => {
  it('shows "needs update" and signals the shortlist after a successful install', async () => {
    setActivePinia(createPinia())
    const fresh = { ...outdated, needsUpdate: false }
    ;(window as unknown as { api: unknown }).api = {
      hpoData: {
        status: vi.fn().mockResolvedValue(outdated),
        update: vi.fn().mockResolvedValue({ success: true, message: 'installed', status: fresh })
      }
    }
    const wrapper = mount(HpoDataRow, { global: { plugins: [createVuetify({ components })] } })
    await flushPromises()
    expect(wrapper.text()).toContain('needs update')
    phenotypeChange.value = null
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(phenotypeChange.value).toEqual({ caseId: null })
    expect(wrapper.text()).not.toContain('needs update')
  })

  it('lists each reference source with its attribution and version', async () => {
    setActivePinia(createPinia())
    const withSources: HpoDataStatus = {
      ...outdated,
      needsUpdate: false,
      sources: {
        hpo: 'v2026-09-01',
        clingen: '2026-10-14',
        strchive: 'v2.28.0',
        mondo: 'v2026-10-06'
      }
    }
    ;(window as unknown as { api: unknown }).api = {
      hpoData: { status: vi.fn().mockResolvedValue(withSources), update: vi.fn() }
    }
    const wrapper = mount(HpoDataRow, { global: { plugins: [createVuetify({ components })] } })
    await flushPromises()
    expect(wrapper.get('[data-testid="hpo-data-sources"]').text()).toBe(
      'Human Phenotype Ontology v2026-09-01 · ClinGen Dosage Sensitivity (CC0) 2026-10-14 · ' +
        'STRchive (MIT) v2.28.0 · Mondo (CC BY 4.0) v2026-10-06'
    )
  })

  it('shows no source line for a pre-builder-6 install', async () => {
    setActivePinia(createPinia())
    ;(window as unknown as { api: unknown }).api = {
      hpoData: { status: vi.fn().mockResolvedValue(outdated), update: vi.fn() }
    }
    const wrapper = mount(HpoDataRow, { global: { plugins: [createVuetify({ components })] } })
    await flushPromises()
    expect(wrapper.find('[data-testid="hpo-data-sources"]').exists()).toBe(false)
  })
})
