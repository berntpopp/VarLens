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

import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import ShortlistTable from '../../../../src/renderer/src/components/shortlist/ShortlistTable.vue'
import { createPinia, setActivePinia } from 'pinia'
import type { ShortlistRow } from '../../../../src/shared/types/shortlist'

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
            sv_length: 1000
          })
        ]
      },
      global: { plugins: [vuetify] }
    })
    expect(wrapper.text()).toContain('2:5000 DEL 1000bp')
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
    expect(text).toContain('3:2000 INS 500bp')
    expect(text).not.toContain('c.999A>G')
    expect(text).not.toContain('p.Arg1Gly')
  })
})
