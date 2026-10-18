import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { VLayout } from 'vuetify/components'
import { createPinia, setActivePinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { installCapabilities } from '../helpers/capabilities'
import VariantDetailsPanel from '../../../src/renderer/src/components/VariantDetailsPanel.vue'

const vuetify = createVuetify({ components, directives })

const mockApplySuggestions = vi.fn()
const mockConfirmLeave = vi.fn(() => null)
let capturedPanelProps: Record<string, unknown> = {}

const MockAcmgClassificationPanel = defineComponent({
  name: 'AcmgClassificationPanel',
  props: {
    variantKey: { type: String, default: null },
    evidenceJson: { type: String, default: null },
    variantData: { type: Object, default: null },
    save: { type: Function, default: null }
  },
  setup(props, { expose }) {
    capturedPanelProps = props
    expose({
      applySuggestions: mockApplySuggestions,
      confirmLeave: mockConfirmLeave
    })
    return () => h('div', { class: 'mock-acmg-panel' })
  }
})

const STUBS = Object.fromEntries(
  [
    'ExternalLinksSection',
    'CommentsSection',
    'TagsSection',
    'ActivityLogPanel',
    'ProteinVisualizationModal',
    'ProteinViewUnavailableDialog',
    'ExtensionDetailsSection',
    'TranscriptSection',
    'AnnotationScoresSection',
    'VariantIdentitySection'
  ].map((name) => [name, { name, template: '<div />' }])
)

let wrapper: VueWrapper | null = null
let pinia: ReturnType<typeof createPinia>

function mountPanelWithVariant(variantDataOverrides: Record<string, unknown> = {}): VueWrapper {
  const variant = {
    id: 1,
    chr: '1',
    pos: 100,
    ref: 'A',
    alt: 'G',
    genome_build: 'GRCh38',
    ...variantDataOverrides
  }
  const props = { open: true, variant, caseId: 10, mode: 'case' as const }
  const Host = defineComponent(
    () => () => h(VLayout, () => [h(VariantDetailsPanel, props)])
  )
  wrapper = mount(Host, {
    global: {
      plugins: [pinia, vuetify],
      stubs: {
        ...STUBS,
        AcmgClassificationPanel: MockAcmgClassificationPanel
      }
    },
    attachTo: document.body
  })
  return wrapper.findComponent(VariantDetailsPanel)
}

describe('VariantDetailsPanel ACMG suggestions preview (#685, #660)', () => {
  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    installCapabilities({ runtime: 'desktop', role: 'user' })
    mockApplySuggestions.mockClear()
    mockConfirmLeave.mockClear()
    capturedPanelProps = {}
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    document.body.innerHTML = ''
  })

  it('renders suggested ACMG code chips when annotations produce suggestions (#685)', async () => {
    const panel = mountPanelWithVariant({
      cadd: 28,
      gnomad_af: 0.000005,
      clinvar: null
    })
    await flushPromises()

    const preview = panel.find('[data-testid="acmg-suggested-preview"]')
    expect(preview.exists()).toBe(true)
    const text = preview.text()
    expect(text).toContain('PP3')
    expect(text).toContain('PM2')
    expect(text).toContain('Apply')
  })

  it('does not render preview when no suggestions are generated (#685)', async () => {
    const panel = mountPanelWithVariant({
      cadd: 18,
      gnomad_af: 0.005,
      clinvar: null
    })
    await flushPromises()

    const preview = panel.find('[data-testid="acmg-suggested-preview"]')
    expect(preview.exists()).toBe(false)
  })

  it('passes variantKey to AcmgClassificationPanel when expanded (#660)', async () => {
    const panel = mountPanelWithVariant({
      chr: 'chr12',
      pos: 500,
      ref: 'C',
      alt: 'T',
      cadd: 28
    })
    await flushPromises()

    await panel.find('.v-expansion-panel-title').trigger('click')
    await flushPromises()

    expect(capturedPanelProps.variantKey).toBe('10:chr12:500:C:T')
  })

  it('clicking Apply suggestions preview expands the panel and calls applySuggestions (#685)', async () => {
    const panel = mountPanelWithVariant({
      cadd: 30,
      gnomad_af: 0.000001
    })
    await flushPromises()

    const applyBtn = panel.find('[data-testid="apply-acmg-suggestions-btn"]')
    expect(applyBtn.exists()).toBe(true)
    await applyBtn.trigger('click')
    await flushPromises()

    expect(mockApplySuggestions).toHaveBeenCalledOnce()
  })
})
