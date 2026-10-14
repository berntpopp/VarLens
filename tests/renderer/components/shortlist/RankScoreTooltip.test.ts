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
import { phenotypeLines } from '../../../../src/renderer/src/components/shortlist/rank-tooltip-phenotype'
import type { HpoExplanation, HpoLocusNote } from '../../../../src/shared/types/hpo-profile'

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

    it('names the phase proven by a shared phase set (#586)', () => {
      const withPhase = (phase: 'trans' | 'cis' | 'possible'): string =>
        mount(RankScoreTooltip, {
          props: {
            score: 6.5,
            components: componentsFixture,
            pinned: null,
            evidence,
            partners: [7],
            phase
          },
          global: { plugins: [vuetify] }
        }).text()
      expect(withPhase('trans')).toContain('Confirmed compound heterozygous, in trans by phase set')
      expect(withPhase('cis')).toContain('In cis by phase set (same haplotype)')
      expect(withPhase('possible')).toContain('Possible compound heterozygous')
    })
  })

  describe('phenotype block (rank_hpo)', () => {
    const match = (label: string, key = false) => ({
      patientTerm: 'HP:1',
      patientLabel: label,
      diseaseTerm: 'HP:1',
      diseaseLabel: label,
      key,
      frequency: 0.5
    })
    const hpo = {
      score: 0.62,
      percentile: 0.97,
      diseaseId: 'OMIM:607208',
      diseaseLabel: 'Dravet syndrome',
      matched: [match('hypotonia'), match('epilepsy', true), match('ataxia'), match('ID')],
      conflicts: [
        {
          excludedTerm: 'HP:0000252',
          excludedLabel: 'microcephaly',
          diseaseTerm: 'HP:0000252',
          diseaseLabel: 'Microcephaly',
          frequency: 0.3,
          annotationFrequency: 0.545,
          frequencyRecorded: true
        },
        {
          excludedTerm: 'HP:0001250',
          excludedLabel: 'ataxia',
          diseaseTerm: 'HP:0001250',
          diseaseLabel: 'Ataxia',
          frequency: 0.15,
          annotationFrequency: 0.35,
          frequencyRecorded: false
        }
      ],
      notConflicts: [
        {
          patientTerm: 'HP:0001263',
          patientLabel: 'delay',
          diseaseTerm: 'HP:0001263',
          diseaseLabel: 'Delay'
        }
      ]
    }

    it('shows best disease, key-first matches capped at 3, conflicts, and a reference-gene rank', () => {
      const wrapper = mount(RankScoreTooltip, {
        props: { score: 3, components: componentsFixture, pinned: null, evidence: [], hpo },
        global: { plugins: [vuetify] }
      })
      const text = wrapper.get('[data-testid="rank-tooltip-phenotype"]').text()
      expect(text).toContain('best: Dravet syndrome')
      expect(text).toContain('✓ matched: ★ epilepsy · hypotonia · ataxia · +1')
      expect(text).toContain(
        '⊖ conflicts: microcephaly excluded (55 % in Dravet syndrome) · ' +
          'ataxia excluded (frequency not recorded) · delay present (absent in Dravet syndrome)'
      )
      expect(text).toContain('scores above 97 % of HPO genes')
      expect(text.toLowerCase()).not.toContain('probab')
    })

    it('rounds the rank down so a near-top tie never claims 100 %', () => {
      expect(phenotypeLines({ ...hpo, percentile: 0.996 }).rank).toBe(
        'scores above 99 % of HPO genes'
      )
      // 0.29 * 100 is 28.999… in floating point.
      expect(phenotypeLines({ ...hpo, percentile: 29 / 100 }).rank).toBe(
        'scores above 29 % of HPO genes'
      )
    })

    describe('locus line (CNV/STR spec §6.3)', () => {
      const region: HpoLocusNote = {
        kind: 'region',
        id: 'ISCA-37400',
        label: '16p11.2 BP4–BP5',
        dosage: 'HI 3 (ClinGen 2026-10-14)',
        coverage: 0.996,
        diseaseGenes: 9,
        genes: 27
      }
      const gene: HpoLocusNote = {
        kind: 'gene',
        id: 'TBX6',
        label: 'TBX6',
        dosage: 'HI 3 (AnnotSV)',
        diseaseGenes: 9,
        genes: 27
      }
      const str: HpoLocusNote = {
        kind: 'str',
        id: 'ATXN3_SCA3',
        label: 'ATXN3',
        motif: 'CAG',
        copies: '72/24',
        band: 'full',
        inheritance: 'AD',
        onset: '20–50'
      }

      it('CNV region route names region, dosage source, coverage and HPO gene count', () => {
        expect(phenotypeLines({ ...hpo, locus: region }).locus).toBe(
          'locus: 16p11.2 BP4–BP5 (ISCA-37400) · HI 3 (ClinGen 2026-10-14) · 99 % covered · ' +
            '9 HPO genes of 27 overlapped'
        )
      })

      it('CNV gene route names the driving gene, dosage source and size correction', () => {
        expect(phenotypeLines({ ...hpo, locus: gene }).locus).toBe(
          'locus: TBX6 · HI 3 (AnnotSV) · best of 9 HPO genes of 27 overlapped, size-corrected'
        )
        // One HPO gene: the Šidák step is the identity, so no size-correction claim.
        expect(
          phenotypeLines({
            ...hpo,
            locus: { ...gene, dosage: undefined, diseaseGenes: 1, genes: undefined }
          }).locus
        ).toBe('locus: TBX6 · best of 1 HPO gene')
      })

      it('STR names locus, motif, copies, band, inheritance and onset; disease stays in the title', () => {
        const lines = phenotypeLines({ ...hpo, locus: str })
        expect(lines.locus).toBe('locus: ATXN3 CAG 72/24 · full · AD · onset 20–50')
        expect(lines.title).toContain('best: Dravet syndrome')
      })

      it('SNV has no locus line and the tooltip renders it only when set', () => {
        expect(phenotypeLines(hpo).locus).toBeNull()
        const text = (h: HpoExplanation) =>
          mount(RankScoreTooltip, {
            props: { score: 3, components: componentsFixture, pinned: null, evidence: [], hpo: h },
            global: { plugins: [vuetify] }
          })
            .get('[data-testid="rank-tooltip-phenotype"]')
            .text()
        expect(text(hpo)).not.toContain('locus:')
        const cnv = text({ ...hpo, locus: region })
        expect(cnv).toContain('locus: 16p11.2 BP4–BP5')
        expect(cnv).toContain('of HPO genes')
        expect(cnv).not.toContain('genes in this case')
        expect(cnv.toLowerCase()).not.toContain('probab')
      })
    })

    it('omits the block without an explanation', () => {
      const wrapper = mount(RankScoreTooltip, {
        props: { score: 3, components: componentsFixture, pinned: null, evidence: [] },
        global: { plugins: [vuetify] }
      })
      expect(wrapper.find('[data-testid="rank-tooltip-phenotype"]').exists()).toBe(false)
    })
  })
})
