/**
 * Unit tests for ShortlistTable.vue — the v-data-table specialized for
 * shortlist rows. Columns: # / Score / Type / Gene / Variant / Impact /
 * AF / ClinVar / ★ / actions.
 *
 * ShortlistTable is a pure presentational leaf — it receives
 * `rows: ShortlistRow[]` as a prop and emits `row-click`, `open-in-tab`,
 * `toggle-star`. No composable, no IPC, no window.api.
 *
 * Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md (§6)
 * Plan: .planning/plans/2026-04-11-unified-shortlist-plan.md (Task 1.D)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import ShortlistTable from '../../../../src/renderer/src/components/shortlist/ShortlistTable.vue'
import { createPinia, setActivePinia } from 'pinia'
import type { ShortlistRow } from '../../../../src/shared/types/shortlist'
import { clinvarDisplayText } from '../../../../src/shared/config/severity.config'
import { AppStateKey, createAppState } from '../../../../src/renderer/src/composables/useAppState'
import { installCapabilities } from '../../helpers/capabilities'
import {
  annotationCache,
  variantKey
} from '../../../../src/renderer/src/composables/useAnnotations'
import { triggerRef, ref, defineComponent, KeepAlive } from 'vue'

let pinia: ReturnType<typeof createPinia>
beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
})

const vuetify = createVuetify({ components, directives })

function row(overrides: Partial<ShortlistRow> = {}): ShortlistRow {
  return {
    id: 1,
    case_id: 1,
    variant_type: 'snv',
    chr: '1',
    pos: 1000,
    ref: 'A',
    alt: 'T',
    gene_symbol: 'BRCA1',
    consequence: 'HIGH',
    cadd: 35,
    gnomad_af: 0.0001,
    clinvar: 'Pathogenic',
    is_starred: false,
    rank: 1,
    rank_score: 0.95,
    rank_components: {
      impact: 1,
      pathogenicity: 0.87,
      rarity: 0.99,
      clinvar: 1,
      phenotype: 0
    },
    rank_clinvar_pinned: true,
    rank_starred_pinned: false,
    ...overrides
  } as ShortlistRow
}

describe('ShortlistTable', () => {
  it('renders one row per input item', () => {
    const wrapper = mount(ShortlistTable, {
      props: { rows: [row({ id: 1 }), row({ id: 2, rank: 2 })] },
      global: { plugins: [vuetify, pinia] }
    })
    // v-data-table renders each item as a <tr>
    expect(wrapper.findAll('tbody tr').length).toBe(2)
  })

  it('displays rank, gene_symbol, and score', () => {
    const wrapper = mount(ShortlistTable, {
      props: { rows: [row()] },
      global: { plugins: [vuetify, pinia] }
    })
    const text = wrapper.text()
    expect(text).toContain('1') // rank
    expect(text).toContain('BRCA1') // gene
    expect(text).toContain('0.95') // score formatted
  })

  it('shows evidence scores as signed points and legacy scores unchanged', () => {
    const wrapper = mount(ShortlistTable, {
      props: {
        rows: [
          row({
            id: 1,
            rank_score: 12.5,
            rank_evidence: [{ kind: 'mode', id: 'ad', label: 'AD het', group: null, points: 12.5 }]
          }),
          row({ id: 2, rank: 2, rank_score: 0.734 })
        ]
      },
      global: { plugins: [vuetify, pinia] }
    })
    expect(wrapper.find('[data-rank-tip="1"]').text()).toBe('+12.5')
    expect(wrapper.find('[data-rank-tip="2"]').text()).toBe('0.73')
  })

  it('opens the score tooltip, with the phenotype block, when the score cell gets focus', async () => {
    const wrapper = mount(ShortlistTable, {
      props: {
        rows: [
          row({
            rank_evidence: [],
            rank_hpo: {
              score: 0.5,
              percentile: 0.9,
              diseaseId: 'OMIM:1',
              diseaseLabel: 'Dravet syndrome',
              matched: [],
              conflicts: [],
              notConflicts: []
            }
          })
        ]
      },
      attachTo: document.body,
      global: { plugins: [vuetify, pinia] }
    })
    const cell = wrapper.get('[data-rank-tip="1"]')
    expect(cell.attributes('tabindex')).toBe('0')
    ;(cell.element as HTMLElement).focus()
    await cell.trigger('focusin')
    await vi.waitFor(() =>
      expect(
        document.body.querySelector('[data-testid="rank-tooltip-phenotype"]')?.textContent
      ).toContain('Dravet syndrome')
    )
    await cell.trigger('keydown', { key: 'Escape' })
    await cell.trigger('focusout')
    wrapper.unmount()
  })

  it('does not open the score tooltip when a mouse click focuses the score cell', async () => {
    const wrapper = mount(ShortlistTable, {
      props: { rows: [row({ rank_evidence: [] })] },
      attachTo: document.body,
      global: { plugins: [vuetify, pinia] }
    })
    const cell = wrapper.get('[data-rank-tip="1"]')
    // Browsers match :focus-visible only for keyboard focus; happy-dom always does.
    vi.spyOn(cell.element, 'matches').mockImplementation((s) => s !== ':focus-visible')
    await cell.trigger('focusin')
    await flushPromises()
    expect(document.body.querySelector('.rank-tooltip')).toBeNull()
    wrapper.unmount()
  })

  it('renders the merged Links column as keyboard-reachable anchors (case/cohort parity)', () => {
    const wrapper = mount(ShortlistTable, {
      props: { rows: [row()] },
      global: { plugins: [vuetify, pinia] }
    })
    expect(wrapper.findAll('th').some((th) => th.text() === 'Links')).toBe(true)
    const varsome = wrapper.find('a[aria-label="Open in VarSome (opens in a new tab)"]')
    expect(varsome.exists()).toBe(true)
    expect(varsome.attributes('href')).toContain('varsome.com')
  })

  it('emits row-click when a row is clicked', async () => {
    const wrapper = mount(ShortlistTable, {
      props: { rows: [row()] },
      global: { plugins: [vuetify, pinia] }
    })
    await wrapper.find('tbody tr').trigger('click')
    const emitted = wrapper.emitted('row-click')
    expect(emitted).toBeTruthy()
    expect((emitted?.[0]?.[0] as ShortlistRow).id).toBe(1)
  })

  it('emits toggle-star when star icon is clicked', async () => {
    const wrapper = mount(ShortlistTable, {
      props: { rows: [row()] },
      global: { plugins: [vuetify, pinia] }
    })
    const star = wrapper.find('[data-testid="shortlist-star-1"]')
    await star.trigger('click')
    expect(wrapper.emitted('toggle-star')).toBeTruthy()
  })

  it('variant_notation for SNV is chr:pos ref>alt', () => {
    const wrapper = mount(ShortlistTable, {
      props: { rows: [row()] },
      global: { plugins: [vuetify, pinia] }
    })
    expect(wrapper.text()).toContain('1:1000 A>T')
  })

  it('variant_notation for SV is chr:pos sv_type sv_length bp', () => {
    const wrapper = mount(ShortlistTable, {
      props: {
        rows: [
          row({
            variant_type: 'sv',
            chr: '2',
            pos: 5000,
            sv_type: 'DEL',
            sv_length: -1000
          })
        ]
      },
      global: { plugins: [vuetify, pinia] }
    })
    expect(wrapper.text()).toContain('2:5000 DEL 1.00 kb')
  })

  it('renders HGVS c. and p. on SNV rows when cdna and aa_change are present', () => {
    const wrapper = mount(ShortlistTable, {
      props: {
        rows: [
          row({
            variant_type: 'snv',
            cdna: '123A>G',
            aa_change: 'Arg41Gly'
          } as Partial<ShortlistRow>)
        ]
      },
      global: { plugins: [vuetify, pinia] }
    })
    const text = wrapper.text()
    expect(text).toContain('1:1000 A>T')
    expect(text).toContain('c.123A>G')
    expect(text).toContain('p.Arg41Gly')
  })

  it('preserves existing c./p. prefixes from annotators like SnpEff', () => {
    const wrapper = mount(ShortlistTable, {
      props: {
        rows: [
          row({
            variant_type: 'snv',
            cdna: 'c.456C>T',
            aa_change: 'p.Pro152Leu'
          } as Partial<ShortlistRow>)
        ]
      },
      global: { plugins: [vuetify, pinia] }
    })
    const text = wrapper.text()
    expect(text).toContain('c.456C>T')
    expect(text).toContain('p.Pro152Leu')
    // Must NOT double-prefix (e.g. "c.c.456C>T")
    expect(text).not.toContain('c.c.')
    expect(text).not.toContain('p.p.')
  })

  it('renders ClinVar with the shared ClinVar cell, not the raw token', () => {
    const wrapper = mount(ShortlistTable, {
      props: { rows: [row({ clinvar: 'Uncertain_significance' } as Partial<ShortlistRow>)] },
      global: { plugins: [vuetify, pinia] }
    })
    expect(wrapper.text()).toContain(clinvarDisplayText('Uncertain_significance'))
    expect(wrapper.text()).not.toContain('Uncertain_significance')
  })

  it('keeps full VEP HGVS as is instead of prefixing c./p. onto the transcript', () => {
    const wrapper = mount(ShortlistTable, {
      props: {
        rows: [
          row({
            variant_type: 'snv',
            cdna: 'ENST00000361682.4:c.186C>T',
            aa_change: 'ENSP00000354346.4:p.Ala62%3D'
          } as Partial<ShortlistRow>)
        ]
      },
      global: { plugins: [vuetify, pinia] }
    })
    const text = wrapper.text()
    expect(text).toContain('ENST00000361682.4:c.186C>T')
    expect(text).toContain('ENSP00000354346.4:p.Ala62=')
    expect(text).not.toContain('c.ENST')
    expect(text).not.toContain('p.ENSP')
  })

  it('omits HGVS lines on SNV rows when cdna/aa_change are null', () => {
    const wrapper = mount(ShortlistTable, {
      props: {
        rows: [
          row({
            variant_type: 'snv',
            cdna: null,
            aa_change: null
          } as Partial<ShortlistRow>)
        ]
      },
      global: { plugins: [vuetify, pinia] }
    })
    const text = wrapper.text()
    expect(text).toContain('1:1000 A>T')
    // No c. or p. HGVS strings should show up
    expect(text).not.toMatch(/\bc\.[A-Z0-9]/)
    expect(text).not.toMatch(/\bp\.[A-Z][a-z]{2}/)
  })

  it('does NOT render HGVS lines on SV/CNV/STR rows', () => {
    const wrapper = mount(ShortlistTable, {
      props: {
        rows: [
          row({
            variant_type: 'sv',
            chr: '3',
            pos: 2000,
            sv_type: 'INS',
            sv_length: 500,
            cdna: '999A>G', // should be ignored for SV
            aa_change: 'Arg1Gly'
          } as Partial<ShortlistRow>)
        ]
      },
      global: { plugins: [vuetify, pinia] }
    })
    const text = wrapper.text()
    expect(text).toContain('3:2000 INS 500 bp')
    expect(text).not.toContain('c.999A>G')
    expect(text).not.toContain('p.Arg1Gly')
  })

  it('ignores window keys while not interactive (hidden tab)', async () => {
    const wrapper = mount(ShortlistTable, {
      props: { rows: [row()], interactive: false },
      global: { plugins: [vuetify, pinia] },
      attachTo: document.body
    })
    for (const key of ['ArrowDown', 's', 'Enter']) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key }))
      await wrapper.vm.$nextTick()
    }
    expect(wrapper.emitted('toggle-star')).toBeUndefined()
    expect(wrapper.emitted('row-click')).toBeUndefined()
    wrapper.unmount()
  })

  it('handles window keys while interactive', async () => {
    const wrapper = mount(ShortlistTable, {
      props: { rows: [row()], interactive: true },
      global: { plugins: [vuetify, pinia] },
      attachTo: document.body
    })
    for (const key of ['ArrowDown', 's']) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key }))
      await wrapper.vm.$nextTick()
    }
    expect(wrapper.emitted('toggle-star')).toHaveLength(1)
    wrapper.unmount()
  })

  it('the row actions menu opens the protein view for the row (case-view parity)', async () => {
    installCapabilities()
    const state = createAppState()
    const item = row({ aa_change: 'p.Met180Val' })
    const wrapper = mount(ShortlistTable, {
      props: { rows: [item] },
      global: { plugins: [vuetify, pinia], provide: { [AppStateKey as symbol]: state } },
      attachTo: document.body
    })
    await wrapper.get('[data-testid="shortlist-actions-1"]').trigger('click')
    await flushPromises()
    const entry = [...document.querySelectorAll<HTMLElement>('.v-list-item')].find((el) =>
      el.textContent?.includes('Protein view')
    )
    entry!.click()
    expect(state.proteinViewRequest.value).toEqual({ variant: item, tab: 'lollipop' })
    wrapper.unmount()
  })

  it('renders accessible title for the actions column header (#669)', () => {
    const wrapper = mount(ShortlistTable, {
      props: { rows: [] },
      global: { plugins: [vuetify, pinia] }
    })
    const headers = wrapper.findComponent({ name: 'VDataTable' }).props('headers') as {
      key: string
      title: string
    }[]
    const actionsHeader = headers.find((h) => h.key === 'actions')
    expect(actionsHeader?.title).toBe('Actions')
    wrapper.unmount()
  })

  describe('triage shortcuts and live details sync (#681)', () => {
    it('dispatches "a" shortcut to emit acmg-click on selected row', async () => {
      const item = row({ id: 10 })
      const wrapper = mount(ShortlistTable, {
        props: { rows: [item], interactive: true },
        global: { plugins: [vuetify, pinia] },
        attachTo: document.body
      })
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
      await wrapper.vm.$nextTick()

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('acmg-click')).toHaveLength(1)
      expect(wrapper.emitted('acmg-click')![0]).toEqual([item])
      wrapper.unmount()
    })

    it('dispatches "c" shortcut to emit comment-click on selected row', async () => {
      const item = row({ id: 20 })
      const wrapper = mount(ShortlistTable, {
        props: { rows: [item], interactive: true },
        global: { plugins: [vuetify, pinia] },
        attachTo: document.body
      })
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
      await wrapper.vm.$nextTick()

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' }))
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('comment-click')).toHaveLength(1)
      expect(wrapper.emitted('comment-click')![0]).toEqual([item])
      wrapper.unmount()
    })

    it('dispatches "i" shortcut to emit row-click on selected row', async () => {
      const item = row({ id: 30 })
      const wrapper = mount(ShortlistTable, {
        props: { rows: [item], interactive: true },
        global: { plugins: [vuetify, pinia] },
        attachTo: document.body
      })
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
      await wrapper.vm.$nextTick()

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i' }))
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('row-click')).toHaveLength(1)
      expect(wrapper.emitted('row-click')![0]).toEqual([item])
      wrapper.unmount()
    })

    it('debounces live details sync on arrow keys when panelOpen is true', async () => {
      vi.useFakeTimers()
      const state = createAppState()
      state.panelOpen.value = true
      const item = row({ id: 40 })
      const wrapper = mount(ShortlistTable, {
        props: { rows: [item], interactive: true },
        global: { plugins: [vuetify, pinia], provide: { [AppStateKey as symbol]: state } },
        attachTo: document.body
      })

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
      await wrapper.vm.$nextTick()

      // Before 100ms debounce
      vi.advanceTimersByTime(50)
      expect(wrapper.emitted('row-click')).toBeUndefined()

      // After 100ms debounce
      vi.advanceTimersByTime(60)
      expect(wrapper.emitted('row-click')).toHaveLength(1)
      expect(wrapper.emitted('row-click')![0]).toEqual([item])

      wrapper.unmount()
      vi.useRealTimers()
    })

    it('does NOT live sync details on arrow keys when panelOpen is false', async () => {
      vi.useFakeTimers()
      const state = createAppState()
      state.panelOpen.value = false
      const item = row({ id: 50 })
      const wrapper = mount(ShortlistTable, {
        props: { rows: [item], interactive: true },
        global: { plugins: [vuetify, pinia], provide: { [AppStateKey as symbol]: state } },
        attachTo: document.body
      })

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
      await wrapper.vm.$nextTick()

      vi.advanceTimersByTime(200)
      expect(wrapper.emitted('row-click')).toBeUndefined()

      wrapper.unmount()
      vi.useRealTimers()
    })

    it('renders ACMG and comment badges when present in annotation cache', async () => {
      const item = row({ chr: '1', pos: 5555, ref: 'C', alt: 'A' })
      const key = variantKey({ chr: '1', pos: 5555, ref: 'C', alt: 'A' })
      annotationCache.value.set(key, {
        global: null,
        perCase: {
          id: 1,
          case_id: 1,
          variant_id: 1,
          is_starred: 0,
          acmg_classification: 'Pathogenic',
          acmg_evidence_count: 2,
          per_case_comment: 'Important variant',
          tags: null,
          created_at: '',
          updated_at: ''
        }
      })
      triggerRef(annotationCache)

      const wrapper = mount(ShortlistTable, {
        props: { rows: [item] },
        global: { plugins: [vuetify, pinia] }
      })

      expect(wrapper.find(`[data-testid="shortlist-acmg-${item.id}"]`).exists()).toBe(true)
      expect(wrapper.find(`[data-testid="shortlist-acmg-${item.id}"]`).text()).toContain('P')
      expect(wrapper.find(`[data-testid="shortlist-comment-${item.id}"]`).exists()).toBe(true)
      wrapper.unmount()
    })

    it('cancels debounced live sync and ignores arrow keys when deactivated via KeepAlive', async () => {
      vi.useFakeTimers()
      const active = ref(true)
      const state = createAppState()
      state.panelOpen.value = true
      const item = row({ id: 50 })

      const Parent = defineComponent({
        components: { KeepAlive, ShortlistTable },
        setup() {
          return { active, state, rows: [item] }
        },
        template: `
          <KeepAlive>
            <ShortlistTable
              v-if="active"
              :rows="rows"
              :interactive="true"
            />
          </KeepAlive>
        `
      })

      const wrapper = mount(Parent, {
        global: { plugins: [vuetify, pinia], provide: { [AppStateKey as symbol]: state } },
        attachTo: document.body
      })

      const table = wrapper.findComponent(ShortlistTable)
      expect(table.exists()).toBe(true)

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
      await wrapper.vm.$nextTick()

      // Deactivate before debounce elapses
      active.value = false
      await flushPromises()

      vi.advanceTimersByTime(200)
      expect(table.emitted('row-click')).toBeUndefined()

      // Arrow key pressed while deactivated must not trigger sync
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
      await wrapper.vm.$nextTick()
      vi.advanceTimersByTime(200)
      expect(table.emitted('row-click')).toBeUndefined()

      wrapper.unmount()
      vi.useRealTimers()
    })
  })

  describe('bulk triage selection (#684)', () => {
    it('selects all rows via header checkbox and displays BulkTriageActionBar', async () => {
      const items = [row({ id: 101 }), row({ id: 102 })]
      const wrapper = mount(ShortlistTable, {
        props: { rows: items },
        global: { plugins: [vuetify, pinia] }
      })

      const selectAll = wrapper.get('[data-testid="bulk-select-all"]')
      await selectAll.setValue(true)
      await flushPromises()

      expect(wrapper.findComponent({ name: 'BulkTriageActionBar' }).exists()).toBe(true)
      expect(wrapper.findComponent({ name: 'BulkTriageActionBar' }).props('selectedCount')).toBe(2)
      wrapper.unmount()
    })

    it('selects individual rows via row checkboxes', async () => {
      const items = [row({ id: 201 }), row({ id: 202 })]
      const wrapper = mount(ShortlistTable, {
        props: { rows: items },
        global: { plugins: [vuetify, pinia] }
      })

      const rowCheckbox = wrapper.get('[data-testid="bulk-select-row-201"]')
      await rowCheckbox.trigger('click')
      await flushPromises()

      expect(wrapper.findComponent({ name: 'BulkTriageActionBar' }).props('selectedCount')).toBe(1)
      wrapper.unmount()
    })

    it('supports Shift+Click range selection respecting sorted order', async () => {
      // In raw order: id 10 ('Z'), id 20 ('A'), id 30 ('M')
      const items = [
        row({ id: 10, gene_symbol: 'Z' }),
        row({ id: 20, gene_symbol: 'A' }),
        row({ id: 30, gene_symbol: 'M' })
      ]
      const wrapper = mount(ShortlistTable, {
        props: { rows: items },
        global: { plugins: [vuetify, pinia] }
      })

      // Sort by gene_symbol asc -> order becomes id 20 ('A'), id 30 ('M'), id 10 ('Z')
      const dataTable = wrapper.findComponent({ name: 'VDataTable' })
      await dataTable.vm.$emit('update:sortBy', [{ key: 'gene_symbol', order: 'asc' }])
      await flushPromises()

      // Click first sorted item (id 20)
      const cb20 = wrapper.get('[data-testid="bulk-select-row-20"]')
      await cb20.trigger('click')
      await flushPromises()

      // Shift+Click last sorted item (id 10)
      // In sorted order [20, 30, 10], range includes all 3 items (20, 30, 10).
      // (In raw order [10, 20, 30], range between 20 and 10 would only include 2 items).
      const cb10 = wrapper.get('[data-testid="bulk-select-row-10"]')
      await cb10.trigger('click', { shiftKey: true })
      await flushPromises()

      const actionBar = wrapper.findComponent({ name: 'BulkTriageActionBar' })
      expect(actionBar.exists()).toBe(true)
      expect(actionBar.props('selectedCount')).toBe(3)
      wrapper.unmount()
    })

    it('supports Shift+Click range selection respecting sorted order with null values', async () => {
      const items = [
        row({ id: 1, gnomad_af: 0.2 }),
        row({ id: 2, gnomad_af: null }),
        row({ id: 3, gnomad_af: 0.1 })
      ]
      const wrapper = mount(ShortlistTable, {
        props: { rows: items },
        global: { plugins: [vuetify, pinia] }
      })

      const dataTable = wrapper.findComponent({ name: 'VDataTable' })

      // Ascending sort: [null (id 2), 0.1 (id 3), 0.2 (id 1)]
      await dataTable.vm.$emit('update:sortBy', [{ key: 'gnomad_af', order: 'asc' }])
      await flushPromises()

      // Click first visible item (id 2, null)
      const cb2 = wrapper.get('[data-testid="bulk-select-row-2"]')
      await cb2.trigger('click')
      await flushPromises()

      // Shift+Click second visible item (id 3, 0.1)
      const cb3 = wrapper.get('[data-testid="bulk-select-row-3"]')
      await cb3.trigger('click', { shiftKey: true })
      await flushPromises()

      const actionBar = wrapper.findComponent({ name: 'BulkTriageActionBar' })
      expect(actionBar.exists()).toBe(true)
      expect(actionBar.props('selectedCount')).toBe(2)

      // Clear selection
      const clearBtn = actionBar.get('[data-testid="bulk-action-clear"]')
      await clearBtn.trigger('click')
      await flushPromises()

      // Descending sort: [0.2 (id 1), 0.1 (id 3), null (id 2)]
      await dataTable.vm.$emit('update:sortBy', [{ key: 'gnomad_af', order: 'desc' }])
      await flushPromises()

      // Click first visible item (id 1, 0.2)
      const cb1 = wrapper.get('[data-testid="bulk-select-row-1"]')
      await cb1.trigger('click')
      await flushPromises()

      // Shift+Click second visible item (id 3, 0.1)
      await cb3.trigger('click', { shiftKey: true })
      await flushPromises()

      expect(actionBar.props('selectedCount')).toBe(2)
      wrapper.unmount()
    })

    it('resynchronizes native checkbox DOM state when Shift+Clicking an already-selected row', async () => {
      const items = [row({ id: 1 }), row({ id: 2 }), row({ id: 3 })]
      const wrapper = mount(ShortlistTable, {
        props: { rows: items },
        global: { plugins: [vuetify, pinia] }
      })

      // 1. Click row 1
      const cb1 = wrapper.get<HTMLInputElement>('[data-testid="bulk-select-row-1"]')
      await cb1.trigger('click')
      expect(cb1.element.checked).toBe(true)

      // 2. Click row 3
      const cb3 = wrapper.get<HTMLInputElement>('[data-testid="bulk-select-row-3"]')
      await cb3.trigger('click')
      expect(cb3.element.checked).toBe(true)

      // 3. Native browser click on cb1 flips .checked to false before click handler runs
      cb1.element.checked = false
      await cb1.trigger('click', { shiftKey: true })

      // Range between 3 and 1 includes 1, 2, 3
      expect(cb1.element.checked).toBe(true)
      wrapper.unmount()
    })
  })
})
