/* eslint-disable vue/one-component-per-file */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
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

function mountPanelWithVariant(
  variantDataOverrides: Record<string, unknown> = {},
  options: {
    mode?: 'case' | 'cohort'
    caseId?: number | null
    customStubs?: Record<string, unknown>
  } = {}
): VueWrapper {
  const variant = {
    id: 1,
    chr: '1',
    pos: 100,
    ref: 'A',
    alt: 'G',
    genome_build: 'GRCh38',
    ...variantDataOverrides
  }
  const mode = options.mode ?? 'case'
  const caseId = options.caseId !== undefined ? options.caseId : mode === 'case' ? 10 : null
  const props = { open: true, variant, caseId, mode }
  const Host = defineComponent(() => () => h(VLayout, () => [h(VariantDetailsPanel, props)]))
  wrapper = mount(Host, {
    global: {
      plugins: [pinia, vuetify],
      stubs: {
        ...STUBS,
        AcmgClassificationPanel: MockAcmgClassificationPanel,
        ...(options.customStubs ?? {})
      }
    },
    attachTo: document.body
  })
  return wrapper.findComponent(VariantDetailsPanel)
}

describe('VariantDetailsPanel ACMG suggestions preview (#685, #660, #669)', () => {
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

    const applyBtn = panel.find('[data-testid="apply-acmg-suggestions-btn"]')
    expect(applyBtn.exists()).toBe(true)
    expect(applyBtn.text()).toContain('Apply suggestions')
  })

  it('does not render preview or apply button when no suggestions are generated (#685)', async () => {
    const panel = mountPanelWithVariant({
      cadd: 18,
      gnomad_af: 0.005,
      clinvar: null
    })
    await flushPromises()

    expect(panel.find('[data-testid="acmg-suggested-preview"]').exists()).toBe(false)
    expect(panel.find('[data-testid="apply-acmg-suggestions-btn"]').exists()).toBe(false)
  })

  it('passes variantKey containing genome_build to AcmgClassificationPanel (#660)', async () => {
    const panel = mountPanelWithVariant({
      chr: 'chr12',
      pos: 500,
      ref: 'C',
      alt: 'T',
      genome_build: 'GRCh38',
      cadd: 28
    })
    await flushPromises()

    await panel.find('.v-expansion-panel-title').trigger('click')
    await flushPromises()

    expect(capturedPanelProps.variantKey).toBe('10:GRCh38:chr12:500:C:T')
  })

  it('includes genome_build in variantKey for cohort variants (#660)', async () => {
    const panel37 = mountPanelWithVariant(
      {
        chr: '1',
        pos: 100,
        ref: 'A',
        alt: 'G',
        genome_build: 'GRCh37',
        cadd: 28
      },
      { mode: 'cohort' }
    )
    await flushPromises()
    await panel37.find('.v-expansion-panel-title').trigger('click')
    await flushPromises()
    const key37 = capturedPanelProps.variantKey

    wrapper?.unmount()

    const panel38 = mountPanelWithVariant(
      {
        chr: '1',
        pos: 100,
        ref: 'A',
        alt: 'G',
        genome_build: 'GRCh38',
        cadd: 28
      },
      { mode: 'cohort' }
    )
    await flushPromises()
    await panel38.find('.v-expansion-panel-title').trigger('click')
    await flushPromises()
    const key38 = capturedPanelProps.variantKey

    expect(key37).toBe(':GRCh37:1:100:A:G')
    expect(key38).toBe(':GRCh38:1:100:A:G')
    expect(key37).not.toBe(key38)
  })

  it('has zero nested interactive elements inside expansion panel title (WCAG 2.2 AA) (#669, #685)', async () => {
    const panel = mountPanelWithVariant({
      cadd: 30,
      gnomad_af: 0.000001
    })
    await flushPromises()

    const titleBtn = panel.find('.v-expansion-panel-title')
    expect(titleBtn.exists()).toBe(true)

    // Ensure zero buttons inside any button
    expect(wrapper!.findAll('button button').length).toBe(0)
    expect(wrapper!.findAll('button [role="button"]').length).toBe(0)
    expect(titleBtn.findAll('button').length).toBe(0)
    expect(titleBtn.findAll('[role="button"]').length).toBe(0)
  })

  it('clicking Apply suggestions expands panel and calls applySuggestions (#685)', async () => {
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

  it('stages suggestions on first click even when AcmgClassificationPanel is lazy-mounted (#685)', async () => {
    const shouldMountInner = ref(false)
    const lazyApplyMock = vi.fn()

    const LazyAcmgClassificationPanel = defineComponent({
      name: 'AcmgClassificationPanel',
      props: {
        variantKey: { type: String, default: null }
      },
      setup(props, { expose }) {
        expose({
          applySuggestions: lazyApplyMock,
          confirmLeave: () => null
        })
        return () => (shouldMountInner.value ? h('div', { class: 'lazy-mounted' }) : null)
      }
    })

    const panel = mountPanelWithVariant(
      { cadd: 30, gnomad_af: 0.000001 },
      { customStubs: { AcmgClassificationPanel: LazyAcmgClassificationPanel } }
    )
    await flushPromises()

    // Panel is initially collapsed and inner component is not ready
    const applyBtn = panel.find('[data-testid="apply-acmg-suggestions-btn"]')
    await applyBtn.trigger('click')
    await flushPromises()

    // Inner component now mounts
    shouldMountInner.value = true
    await flushPromises()

    expect(lazyApplyMock).toHaveBeenCalledOnce()
  })
})
