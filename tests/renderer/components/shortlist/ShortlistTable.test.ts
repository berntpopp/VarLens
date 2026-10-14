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

// ShortlistTable resolves its Links column through the external-links store
beforeEach(() => setActivePinia(createPinia()))

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
      global: { plugins: [vuetify] }
    })
    // v-data-table renders each item as a <tr>
    expect(wrapper.findAll('tbody tr').length).toBe(2)
  })

  it('displays rank, gene_symbol, and score', () => {
    const wrapper = mount(ShortlistTable, {
      props: { rows: [row()] },
      global: { plugins: [vuetify] }
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
      global: { plugins: [vuetify] }
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
              conflicts: []
            }
          })
        ]
      },
      attachTo: document.body,
      global: { plugins: [vuetify] }
    })
    const cell = wrapper.get('[data-rank-tip="1"]')
    expect(cell.attributes('tabindex')).toBe('0')
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

  it('renders the merged Links column as keyboard-reachable anchors (case/cohort parity)', () => {
    const wrapper = mount(ShortlistTable, {
      props: { rows: [row()] },
      global: { plugins: [vuetify] }
    })
    expect(wrapper.findAll('th').some((th) => th.text() === 'Links')).toBe(true)
    const varsome = wrapper.find('a[aria-label="Open in VarSome (opens in a new tab)"]')
    expect(varsome.exists()).toBe(true)
    expect(varsome.attributes('href')).toContain('varsome.com')
  })

  it('emits row-click when a row is clicked', async () => {
    const wrapper = mount(ShortlistTable, {
      props: { rows: [row()] },
      global: { plugins: [vuetify] }
    })
    await wrapper.find('tbody tr').trigger('click')
    const emitted = wrapper.emitted('row-click')
    expect(emitted).toBeTruthy()
    expect((emitted?.[0]?.[0] as ShortlistRow).id).toBe(1)
  })

  it('emits toggle-star when star icon is clicked', async () => {
    const wrapper = mount(ShortlistTable, {
      props: { rows: [row()] },
      global: { plugins: [vuetify] }
    })
    const star = wrapper.find('[data-testid="shortlist-star-1"]')
    await star.trigger('click')
    expect(wrapper.emitted('toggle-star')).toBeTruthy()
  })

  it('variant_notation for SNV is chr:pos ref>alt', () => {
    const wrapper = mount(ShortlistTable, {
      props: { rows: [row()] },
      global: { plugins: [vuetify] }
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
      global: { plugins: [vuetify] }
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
      global: { plugins: [vuetify] }
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
      global: { plugins: [vuetify] }
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
      global: { plugins: [vuetify] }
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
      global: { plugins: [vuetify] }
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
      global: { plugins: [vuetify] }
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
      global: { plugins: [vuetify] }
    })
    const text = wrapper.text()
    expect(text).toContain('3:2000 INS 500 bp')
    expect(text).not.toContain('c.999A>G')
    expect(text).not.toContain('p.Arg1Gly')
  })

  it('ignores window keys while not interactive (hidden tab)', async () => {
    const wrapper = mount(ShortlistTable, {
      props: { rows: [row()], interactive: false },
      global: { plugins: [vuetify] },
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
      global: { plugins: [vuetify] },
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
      global: { plugins: [vuetify], provide: { [AppStateKey as symbol]: state } },
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
})
