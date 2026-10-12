import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { VLayout } from 'vuetify/components'
import { createPinia, setActivePinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { installCapabilities } from '../helpers/capabilities'

const evidence = vi.hoisted(() => ({ json: null as string | null }))
const setAcmgClassification = vi.hoisted(() => vi.fn(async () => true))

vi.mock('../../../src/renderer/src/composables/useAnnotations', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../src/renderer/src/composables/useAnnotations')>()
  return {
    ...actual,
    useAnnotations: () => ({
      ...actual.useAnnotations(),
      getAcmgEvidence: () => evidence.json,
      getGlobalAcmgEvidence: () => evidence.json
    })
  }
})
vi.mock('../../../src/renderer/src/composables/useAcmgUndo', () => ({
  useAcmgUndo: () => ({
    setAcmgClassification,
    setGlobalAcmgClassification: setAcmgClassification,
    setAcmgClassificationWithEvidence: vi.fn(),
    setGlobalAcmgClassificationWithEvidence: vi.fn()
  })
}))

import VariantDetailsPanel from '../../../src/renderer/src/components/VariantDetailsPanel.vue'

const vuetify = createVuetify({ components, directives })
const STUBS = Object.fromEntries(
  [
    'ExternalLinksSection',
    'CommentsSection',
    'TagsSection',
    'AcmgClassificationPanel',
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

function mountPanel(mode: 'case' | 'cohort' = 'case'): VueWrapper {
  const variant = { id: 1, chr: '1', pos: 100, ref: 'A', alt: 'G', genome_build: 'GRCh38' }
  const props = { open: true, variant, caseId: mode === 'case' ? 1 : null, mode }
  // The navigation drawer needs a Vuetify layout around it
  const Host = defineComponent(() => () => h(VLayout, () => h(VariantDetailsPanel, props)))
  wrapper = mount(Host, { global: { plugins: [vuetify], stubs: STUBS }, attachTo: document.body })
  return wrapper.findComponent(VariantDetailsPanel)
}

beforeEach(() => {
  setActivePinia(createPinia())
  installCapabilities({ runtime: 'desktop', role: 'user' })
  evidence.json = null
  setAcmgClassification.mockClear()
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('VariantDetailsPanel Escape', () => {
  it('closes on Escape from the page', () => {
    const w = mountPanel()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(w.emitted('update:open')).toEqual([[false]])
  })

  it('stays open on Escape inside a text field (cancels the edit only)', () => {
    const w = mountPanel()
    const input = document.createElement('textarea')
    document.body.appendChild(input)
    input.focus()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(w.emitted('update:open')).toBeUndefined()
  })

  it('stays open on Escape inside an open overlay (menu)', () => {
    const w = mountPanel()
    const overlay = document.createElement('div')
    overlay.className = 'v-overlay'
    const item = document.createElement('button')
    overlay.appendChild(item)
    document.body.appendChild(overlay)
    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(w.emitted('update:open')).toBeUndefined()
  })
})
