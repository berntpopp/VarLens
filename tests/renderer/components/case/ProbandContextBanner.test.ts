import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import ProbandContextBanner from '../../../../src/renderer/src/components/case/ProbandContextBanner.vue'
import { useCaseMetadata } from '../../../../src/renderer/src/composables/useCaseMetadata'
import { createMockApi } from '../../../utils/mock-api'

const vuetify = createVuetify({ components, directives })

describe('ProbandContextBanner', () => {
  beforeEach(() => {
    window.api = createMockApi()
    vi.clearAllMocks()
    useCaseMetadata().clearCache()
  })

  afterEach(() => {
    useCaseMetadata().clearCache()
  })

  it('renders sex, age, and affected status correctly when metadata is loaded', async () => {
    window.api.caseMetadata.getFullMetadata = vi.fn().mockResolvedValue({
      metadata: {
        id: 1,
        case_id: 10,
        family_id: 'FAM01',
        proband_name: 'Patient X',
        sex: 'female',
        affected_status: 'affected',
        age: 4,
        created_at: Date.now(),
        updated_at: Date.now()
      },
      cohorts: [],
      hpoTerms: [
        {
          id: 1,
          case_id: 10,
          hpo_id: 'HP:0001250',
          hpo_label: 'Seizures',
          created_at: Date.now()
        }
      ],
      comments: [],
      metrics: [],
      dataInfo: null,
      externalIds: []
    })

    const wrapper = mount(ProbandContextBanner, {
      props: {
        caseId: 10,
        caseName: 'Case 001'
      },
      global: {
        plugins: [vuetify]
      }
    })

    await flushPromises()

    expect(wrapper.text()).toContain('Case 001')
    expect(wrapper.text()).toContain('female')
    expect(wrapper.text()).toContain('4y')
    expect(wrapper.text()).toContain('affected')
    expect(wrapper.text()).toContain('Seizures')
  })

  it('emits edit when edit button is clicked', async () => {
    window.api.caseMetadata.getFullMetadata = vi.fn().mockResolvedValue({
      metadata: null,
      cohorts: [],
      hpoTerms: [],
      comments: [],
      metrics: [],
      dataInfo: null,
      externalIds: []
    })

    const wrapper = mount(ProbandContextBanner, {
      props: {
        caseId: 10,
        caseName: 'Case 001'
      },
      global: {
        plugins: [vuetify]
      }
    })

    await flushPromises()

    const btn = wrapper.find('button[aria-label="Edit Case Phenotypes and Metadata"]')
    expect(btn.exists()).toBe(true)
    await btn.trigger('click')

    expect(wrapper.emitted('edit')).toBeTruthy()
  })
})
