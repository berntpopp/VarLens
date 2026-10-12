/**
 * Unit tests for RankScoreTooltip.vue — the v-tooltip content that breaks
 * down a shortlist row's `rank_score` into its five component sub-scores
 * (impact / pathogenicity / rarity / clinvar / phenotype) plus a
 * "Pinned: ..." line when the row was promoted by clinvarPinTop or
 * pinStarredTop.
 *
 * Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md (§6)
 * Plan: .planning/plans/2026-04-11-unified-shortlist-plan.md (Task 1.D)
 */

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import RankScoreTooltip from '../../../../src/renderer/src/components/shortlist/RankScoreTooltip.vue'

const vuetify = createVuetify({ components, directives })

const componentsFixture = {
  impact: 1,
  pathogenicity: 0.8,
  rarity: 0.98,
  clinvar: 1,
  phenotype: 0
}

describe('RankScoreTooltip', () => {
  it('renders the total score', () => {
    const wrapper = mount(RankScoreTooltip, {
      props: { score: 0.945, components: componentsFixture, pinned: null },
      global: { plugins: [vuetify] }
    })
    expect(wrapper.text()).toContain('0.94')
  })

  it('renders each component row', () => {
    const wrapper = mount(RankScoreTooltip, {
      props: { score: 0.945, components: componentsFixture, pinned: null },
      global: { plugins: [vuetify] }
    })
    const text = wrapper.text()
    expect(text).toContain('Impact')
    expect(text).toContain('Pathogenicity')
    expect(text).toContain('Rarity')
    expect(text).toContain('ClinVar')
    expect(text).toContain('Phenotype')
  })

  it('shows "Pinned: ClinVar P/LP" when pinned=clinvar', () => {
    const wrapper = mount(RankScoreTooltip, {
      props: { score: 0.945, components: componentsFixture, pinned: 'clinvar' },
      global: { plugins: [vuetify] }
    })
    expect(wrapper.text()).toContain('ClinVar P/LP')
  })

  it('shows "Pinned: Starred" when pinned=starred', () => {
    const wrapper = mount(RankScoreTooltip, {
      props: { score: 0.5, components: componentsFixture, pinned: 'starred' },
      global: { plugins: [vuetify] }
    })
    expect(wrapper.text()).toContain('Starred')
  })

  it('hides pin line when pinned=null', () => {
    const wrapper = mount(RankScoreTooltip, {
      props: { score: 0.5, components: componentsFixture, pinned: null },
      global: { plugins: [vuetify] }
    })
    expect(wrapper.text()).not.toContain('Pinned:')
  })

  describe('evidence rows', () => {
    const evidence = [
      { kind: 'mode' as const, id: 'ar_comphet', label: 'AR compound het', group: null, points: 2 },
      { kind: 'rule' as const, id: 'lof', label: 'Loss of function', group: 'effect', points: 5 },
      { kind: 'rule' as const, id: 'syn', label: 'Synonymous', group: 'effect', points: -0.5 }
    ]
    const mountEvidence = (partners: number[]): ReturnType<typeof mount> =>
      mount(RankScoreTooltip, {
        props: { score: 6.5, components: componentsFixture, pinned: null, evidence, partners },
        global: { plugins: [vuetify] }
      })

    it('lists the mode first, then each contribution with signed points', () => {
      const rows = mountEvidence([]).findAll('.rank-tooltip__row')
      expect(rows.map((r) => r.findAll('span').map((x) => x.text()))).toEqual([
        ['AR compound het', '+2.0'],
        ['Loss of function', '+5.0'],
        ['Synonymous', '-0.5']
      ])
      const text = mountEvidence([]).text()
      expect(text).toContain('Evidence score: +6.5')
      expect(text).not.toContain('Pathogenicity')
      expect(text).not.toContain('compound heterozygous')
    })

    it('names possible compound heterozygosity with the partner count', () => {
      expect(mountEvidence([7]).text()).toContain(
        'Possible compound heterozygous (with 1 other variant)'
      )
      expect(mountEvidence([7, 9]).text()).toContain('(with 2 other variants)')
    })
  })
})
