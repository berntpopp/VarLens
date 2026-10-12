import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { VBtn, VLayout, VList, VListItem, VMenu } from 'vuetify/components'
import { flushPromises } from '@vue/test-utils'
import { isInputFocused } from '../../../src/renderer/src/composables/useTableKeyboardNav'
import { createPinia, setActivePinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { ACMG_ABBREV, ACMG_CLASSIFICATIONS } from '../../../src/shared/config/domain.config'
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

// A real menu, opened by mouse: Vuetify leaves focus on its activator
const MouseMenu = defineComponent(
  () => () =>
    h(VMenu, null, {
      activator: ({ props }: { props: Record<string, unknown> }) =>
        h(VBtn, { ...props, class: 'menu-activator' }, () => 'Tags'),
      default: () => h(VList, () => h(VListItem, { title: 'tag' }))
    })
)

function mountPanel(mode: 'case' | 'cohort' = 'case'): VueWrapper {
  const variant = { id: 1, chr: '1', pos: 100, ref: 'A', alt: 'G', genome_build: 'GRCh38' }
  const props = { open: true, variant, caseId: mode === 'case' ? 1 : null, mode }
  // The navigation drawer needs a Vuetify layout around it
  const Host = defineComponent(
    () => () => h(VLayout, () => [h(VariantDetailsPanel, props), h(MouseMenu)])
  )
  wrapper = mount(Host, { global: { plugins: [vuetify], stubs: STUBS }, attachTo: document.body })
  return wrapper.findComponent(VariantDetailsPanel)
}

function quickChip(w: VueWrapper, abbrev: string) {
  return w.findAll('.acmg-section .v-chip').find((c) => c.text() === abbrev)!
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
  it('stays open on Escape while a mouse-opened menu is open (the menu owns it)', async () => {
    const w = mountPanel()
    await flushPromises() // the panel moves focus to its heading on open
    const activator = document.querySelector<HTMLElement>('.menu-activator')!
    activator.focus()
    activator.click()
    await flushPromises()
    expect(document.querySelector('.v-menu.v-overlay--active')).not.toBeNull()
    expect(document.activeElement).toBe(activator)
    expect(isInputFocused()).toBe(true) // table row shortcuts stand down too
    activator.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(w.emitted('update:open')).toBeUndefined()
  })

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
})

describe.each(['case', 'cohort'] as const)('ACMG quick chips (%s)', (mode) => {
  it('write the class when no evidence is stored', async () => {
    const w = mountPanel(mode)
    await quickChip(w, ACMG_ABBREV[ACMG_CLASSIFICATIONS[0]]).trigger('click')
    expect(setAcmgClassification).toHaveBeenCalledOnce()
  })

  it('stay enabled with only a note (no criterion decides the class)', async () => {
    evidence.json = '{"notes":"segregates"}'
    const w = mountPanel(mode)
    await quickChip(w, ACMG_ABBREV[ACMG_CLASSIFICATIONS[0]]).trigger('click')
    expect(setAcmgClassification).toHaveBeenCalledOnce()
  })

  it('are disabled when evidence exists, so they cannot contradict it', async () => {
    evidence.json = '{"pathogenic":["PM2","PP3"]}'
    const w = mountPanel(mode)
    for (const cls of ACMG_CLASSIFICATIONS) {
      const chip = quickChip(w, ACMG_ABBREV[cls])
      expect(chip.classes()).toContain('v-chip--disabled')
      await chip.trigger('click')
    }
    expect(setAcmgClassification).not.toHaveBeenCalled()
  })
})
