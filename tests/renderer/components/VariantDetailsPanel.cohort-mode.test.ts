import { describe, expect, it } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import VariantDetailsPanel from '../../../src/renderer/src/components/VariantDetailsPanel.vue'
import ExtensionDetailsSection from '../../../src/renderer/src/components/variant-details/ExtensionDetailsSection.vue'
import { installCapabilities } from '../helpers/capabilities'

const vuetify = createVuetify({ components, directives })

const ASYNC_STUBS = Object.fromEntries(
  [
    'ExternalLinksSection',
    'CommentsSection',
    'TagsSection',
    'AcmgClassificationPanel',
    'ActivityLogPanel',
    'ProteinVisualizationModal',
    'ProteinViewUnavailableDialog',
    'ExtensionDetailsSection'
  ].map((name) => [name, { name, template: '<div />' }])
)

describe('VariantDetailsPanel cohort mode (#503)', () => {
  it('does not render ExtensionDetailsSection for cohort rows of type sv', () => {
    setActivePinia(createPinia())
    installCapabilities({ runtime: 'desktop', role: 'user' })
    const cohortVariant = {
      chr: '1',
      pos: 100,
      ref: 'N',
      alt: '<DEL>',
      variant_type: 'sv',
      genome_build: 'GRCh38'
    }
    const wrapper = shallowMount(VariantDetailsPanel, {
      props: {
        open: true,
        variant: cohortVariant as never,
        caseId: null,
        mode: 'cohort'
      },
      global: {
        plugins: [vuetify],
        renderStubDefaultSlot: true,
        stubs: ASYNC_STUBS
      }
    })
    expect(wrapper.findComponent(ExtensionDetailsSection).exists()).toBe(false)
  })

  it('renders ExtensionDetailsSection for case mode sv variants', () => {
    setActivePinia(createPinia())
    installCapabilities({ runtime: 'desktop', role: 'user' })
    const caseVariant = {
      id: 1,
      chr: '1',
      pos: 100,
      ref: 'N',
      alt: '<DEL>',
      variant_type: 'sv',
      genome_build: 'GRCh38'
    }
    const wrapper = shallowMount(VariantDetailsPanel, {
      props: {
        open: true,
        variant: caseVariant as never,
        caseId: 1,
        mode: 'case'
      },
      global: {
        plugins: [vuetify],
        renderStubDefaultSlot: true,
        stubs: ASYNC_STUBS
      }
    })
    expect(wrapper.findComponent(ExtensionDetailsSection).exists()).toBe(true)
  })
})
