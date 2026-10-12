/**
 * Shared per-table overlays: one v-menu for all rows (ACMG quick-classify in
 * the case + cohort tables, shortlist row actions).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  ACMG_CLASSIFICATIONS,
  ACMG_EVIDENCE_LOCK_HINT
} from '../../../../src/shared/config/domain.config'
import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { useSharedMenu } from '../../../../src/renderer/src/components/table-cells/shared-menu'
import { provideAcmgQuickMenu } from '../../../../src/renderer/src/components/table-cells/acmg-quick-menu'
import AnnotationsCell from '../../../../src/renderer/src/components/table-cells/AnnotationsCell.vue'
import AcmgQuickMenu from '../../../../src/renderer/src/components/table-cells/AcmgQuickMenu.vue'
import { AppStateKey, createAppState } from '../../../../src/renderer/src/composables/useAppState'
import { PROTEIN_VIEW_COPY } from '../../../../src/renderer/src/config/proteinViewConfig'
import { installCapabilities } from '../../helpers/capabilities'

const vuetify = createVuetify({ components, directives })

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('useSharedMenu', () => {
  it('opens for a button, closes when the same button is used again', () => {
    const menu = useSharedMenu<number>()
    const a = document.createElement('button')
    menu.toggle(a, 1)
    expect(menu.open.value).toBe(true)
    expect(menu.payload.value).toBe(1)
    expect(menu.isOpenFor(a)).toBe(true)
    menu.toggle(a, 1)
    expect(menu.open.value).toBe(false)
    expect(menu.isOpenFor(a)).toBe(false)
  })

  it('re-anchors to another row after the click-outside of the same click has run', () => {
    vi.useFakeTimers()
    const menu = useSharedMenu<number>()
    const a = document.createElement('button')
    const b = document.createElement('button')
    menu.toggle(a, 1)
    menu.toggle(b, 2)
    // Closed for this task (the overlay's deferred click-outside runs next) ...
    expect(menu.open.value).toBe(false)
    expect(menu.activator.value).toBe(b)
    expect(menu.payload.value).toBe(2)
    vi.runAllTimers()
    // ... then reopened on the new row.
    expect(menu.open.value).toBe(true)
    expect(menu.isOpenFor(b)).toBe(true)
    expect(menu.isOpenFor(a)).toBe(false)
  })

  it('does not reopen a stale row if another toggle happened in between', () => {
    vi.useFakeTimers()
    const menu = useSharedMenu<number>()
    const a = document.createElement('button')
    const b = document.createElement('button')
    const c = document.createElement('button')
    menu.toggle(a, 1)
    menu.toggle(b, 2)
    menu.activator.value = c
    vi.runAllTimers()
    expect(menu.open.value).toBe(false)
  })
})

describe('AnnotationsCell with a table-provided ACMG menu', () => {
  const props = { isStarred: false, acmgClassification: null, hasComment: false }

  function mountTable(rows: number) {
    let state: ReturnType<typeof provideAcmgQuickMenu> | null = null
    const Table = defineComponent({
      setup() {
        state = provideAcmgQuickMenu()
        return () =>
          h('div', [
            ...Array.from({ length: rows }, (_, i) => h(AnnotationsCell, { ...props, key: i })),
            h(AcmgQuickMenu, { state: state! })
          ])
      }
    })
    const wrapper = mount(Table, { global: { plugins: [vuetify] }, attachTo: document.body })
    return { wrapper, state: () => state! }
  }

  it('mounts one menu for all rows instead of one per row', () => {
    const { wrapper } = mountTable(5)
    expect(wrapper.findAllComponents(components.VMenu)).toHaveLength(1)
    wrapper.unmount()
  })

  it('opens the shared menu anchored to the clicked row and routes the selection', async () => {
    const { wrapper, state } = mountTable(3)
    const cells = wrapper.findAllComponents(AnnotationsCell)
    const acmgButton = cells[1].findAll('button.annotation-btn')[1]
    expect(acmgButton.attributes('aria-haspopup')).toBe('menu')
    await acmgButton.trigger('click')
    expect(state().isOpenFor(acmgButton.element as HTMLElement)).toBe(true)
    expect(acmgButton.attributes('aria-expanded')).toBe('true')
    state().payload.value?.select('Benign')
    state().payload.value?.openEvidence()
    expect(cells[1].emitted('acmg-select')).toEqual([['Benign']])
    expect(cells[1].emitted('acmg-evidence-click')).toHaveLength(1)
    expect(cells[0].emitted('acmg-select')).toBeUndefined()
    wrapper.unmount()
  })

  it('keeps a private menu when rendered outside a table', async () => {
    const wrapper = mount(AnnotationsCell, {
      props,
      global: { plugins: [vuetify] },
      attachTo: document.body
    })
    expect(wrapper.findAllComponents(components.VMenu)).toHaveLength(1)
    await wrapper.findAll('button.annotation-btn')[1].trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('Evidence editor')
    wrapper.unmount()
  })

  it('disables the quick classes when the row has stored evidence', async () => {
    const wrapper = mount(AnnotationsCell, {
      props: { ...props, acmgClassification: 'Pathogenic', acmgLocked: true },
      global: { plugins: [vuetify] },
      attachTo: document.body
    })
    await wrapper.findAll('button.annotation-btn')[1].trigger('click')
    await flushPromises()
    const chips = [...document.body.querySelectorAll('.v-overlay .v-chip')]
    expect(chips.length).toBe(ACMG_CLASSIFICATIONS.length)
    for (const chip of chips) {
      expect(chip.classList).toContain('v-chip--disabled')
      ;(chip as HTMLElement).click()
    }
    expect(document.body.textContent).toContain(ACMG_EVIDENCE_LOCK_HINT)
    expect(document.body.textContent).not.toContain('Clear classification')
    expect(document.body.textContent).toContain('Evidence editor')
    expect(wrapper.emitted('acmg-select')).toBeUndefined()
    wrapper.unmount()
  })
})

describe('Row quick menu: Protein view (case + cohort tables)', () => {
  const variant = { chr: 'chr22', pos: 1, ref: 'A', alt: 'G', gene_symbol: 'THOC5' }

  async function openMenu(aaChange: string | null, gene: string | null = 'THOC5') {
    installCapabilities()
    const state = createAppState()
    const row = { ...variant, aa_change: aaChange, gene_symbol: gene }
    const wrapper = mount(AnnotationsCell, {
      props: {
        isStarred: false,
        acmgClassification: null,
        hasComment: false,
        variant: row as never
      },
      global: { plugins: [vuetify], provide: { [AppStateKey as symbol]: state } },
      attachTo: document.body
    })
    await wrapper.findAll('button.annotation-btn')[1].trigger('click')
    await flushPromises()
    const item = [...document.querySelectorAll<HTMLElement>('.v-list-item')].find((el) =>
      el.textContent?.includes('Protein view')
    )
    return { wrapper, state, row, item: item! }
  }

  it('opens the protein view for the row', async () => {
    const { wrapper, state, row, item } = await openMenu('p.Met180Val')
    item.click()
    expect(state.proteinViewRequest.value).toEqual({ variant: row, tab: 'lollipop' })
    wrapper.unmount()
  })

  it('is disabled with the reason when the row has no gene', async () => {
    const { wrapper, state, item } = await openMenu('p.Met180Val', null)
    expect(item.classList).toContain('v-list-item--disabled')
    expect(item.textContent).toContain(PROTEIN_VIEW_COPY.noGene)
    item.click()
    expect(state.proteinViewOpen.value).toBe(false)
    wrapper.unmount()
  })
})
