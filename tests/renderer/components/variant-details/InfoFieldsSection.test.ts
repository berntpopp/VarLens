import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import InfoFieldsSection from '../../../../src/renderer/src/components/variant-details/InfoFieldsSection.vue'
import KeptFieldsList from '../../../../src/renderer/src/components/case-data-info/KeptFieldsList.vue'
import { createQueryPinia, queryPlugins } from '../../helpers/with-queries'

const vuetify = createVuetify({ components, directives })
const dictionary = JSON.stringify({ REVEL: 'CSQ:REVEL_score', AltAF_Index: 'JSON:AltAF-Index' })

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).api
})

describe('InfoFieldsSection (#596)', () => {
  it('shows each info.<KEY> value with its source from the case field dictionary', async () => {
    const getDataInfo = vi.fn(async () => ({ field_dictionary: dictionary }))
    ;(window as unknown as Record<string, unknown>).api = { caseMetadata: { getDataInfo } }
    const wrapper = mount(InfoFieldsSection, {
      props: { infoJson: '{"REVEL":"0.81","OLD":"x"}', caseId: 7 },
      global: { plugins: [vuetify, ...queryPlugins(createQueryPinia())] }
    })
    await flushPromises()
    expect(getDataInfo).toHaveBeenCalledWith(7)
    const text = wrapper.text()
    expect(text).toContain('info.REVEL')
    expect(text).toContain('0.81')
    expect(text).toContain('CSQ:REVEL_score')
    // A key the dictionary does not list is still shown, without a source.
    expect(text).toContain('info.OLD')
  })

  it('renders nothing without stored fields', () => {
    ;(window as unknown as Record<string, unknown>).api = {
      caseMetadata: { getDataInfo: vi.fn(async () => null) }
    }
    const wrapper = mount(InfoFieldsSection, {
      props: { infoJson: null, caseId: 7 },
      global: { plugins: [vuetify, ...queryPlugins(createQueryPinia())] }
    })
    expect(wrapper.find('[data-testid="info-fields-section"]').exists()).toBe(false)
  })
})

describe('KeptFieldsList (#596)', () => {
  it('lists the kept fields and their sources', () => {
    const wrapper = mount(KeptFieldsList, {
      props: { fieldDictionary: dictionary },
      global: { plugins: [vuetify] }
    })
    const rows = wrapper.findAll('tbody tr').map((row) => row.text())
    expect(rows).toEqual(['info.AltAF_IndexJSON:AltAF-Index', 'info.REVELCSQ:REVEL_score'])
  })

  it('explains an empty dictionary', () => {
    const wrapper = mount(KeptFieldsList, {
      props: { fieldDictionary: null },
      global: { plugins: [vuetify] }
    })
    expect(wrapper.text()).toMatch(/No field sources recorded/)
  })
})
