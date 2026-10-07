import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import CohortTableRow from '../../../src/renderer/src/components/cohort/CohortTableRow.vue'
import type { CohortVariant } from '../../../src/shared/types/cohort'
import { createMockApi } from '../../utils/mock-api'
import { mdiStar, mdiStarOutline, mdiCommentOutline, mdiComment } from '@mdi/js'

const vuetify = createVuetify({ components, directives })

describe('CohortTableRow', () => {
  beforeEach(() => {
    window.api = createMockApi()
  })

  const mockVariant: CohortVariant = {
    chr: '17',
    pos: 43044295,
    ref: 'A',
    alt: 'G',
    gene_symbol: 'BRCA1',
    consequence: 'HIGH',
    func: 'missense_variant',
    gnomad_af: 0.0001,
    cadd_phred: 25.5,
    carrier_count: 3,
    total_cases: 20,
    cohort_frequency: 0.15,
    het_count: 2,
    hom_count: 1,
    cdna: 'c.181T>G',
    aa_change: 'p.Cys61Gly',
    clinvar: 'Pathogenic'
  }

  describe('Annotations Column', () => {
    it('renders star icon when isStarred is false', () => {
      const wrapper = mount(CohortTableRow, {
        props: {
          item: mockVariant,
          column: 'annotations',
          isStarred: false,
          acmgClassification: null,
          hasComment: false
        },
        global: { plugins: [vuetify] }
      })

      const starIcon = wrapper.findAll('.v-icon').find((w) => w.html().includes(mdiStarOutline))
      expect(starIcon?.exists()).toBe(true)
    })

    it('renders filled star icon when isStarred is true', () => {
      const wrapper = mount(CohortTableRow, {
        props: {
          item: mockVariant,
          column: 'annotations',
          isStarred: true,
          acmgClassification: null,
          hasComment: false
        },
        global: { plugins: [vuetify] }
      })

      const starIcon = wrapper.findAll('.v-icon').find((w) => w.html().includes(mdiStar))
      expect(starIcon?.exists()).toBe(true)
    })

    it('shows ACMG badge when classification provided', () => {
      const wrapper = mount(CohortTableRow, {
        props: {
          item: mockVariant,
          column: 'annotations',
          isStarred: false,
          acmgClassification: 'Pathogenic',
          hasComment: false
        },
        global: { plugins: [vuetify] }
      })

      const acmgChip = wrapper.find('.v-chip')
      expect(acmgChip.exists()).toBe(true)
      expect(acmgChip.text()).toContain('P')
    })

    it('shows tag icon when no ACMG classification', () => {
      const wrapper = mount(CohortTableRow, {
        props: {
          item: mockVariant,
          column: 'annotations',
          isStarred: false,
          acmgClassification: null,
          hasComment: false
        },
        global: { plugins: [vuetify] }
      })

      // Tag icon should be present when no ACMG classification
      const icons = wrapper.findAll('.v-icon')
      expect(icons.length).toBeGreaterThanOrEqual(2)
    })

    it('shows comment icon when hasComment is false', () => {
      const wrapper = mount(CohortTableRow, {
        props: {
          item: mockVariant,
          column: 'annotations',
          isStarred: false,
          acmgClassification: null,
          hasComment: false
        },
        global: { plugins: [vuetify] }
      })

      const commentIcon = wrapper
        .findAll('.v-icon')
        .find((w) => w.html().includes(mdiCommentOutline))
      expect(commentIcon?.exists()).toBe(true)
    })

    it('shows filled comment icon when hasComment is true', () => {
      const wrapper = mount(CohortTableRow, {
        props: {
          item: mockVariant,
          column: 'annotations',
          isStarred: false,
          acmgClassification: null,
          hasComment: true
        },
        global: { plugins: [vuetify] }
      })

      const commentIcon = wrapper.findAll('.v-icon').find((w) => w.html().includes(mdiComment))
      expect(commentIcon?.exists()).toBe(true)
    })

    it('emits star-toggle when star clicked', async () => {
      const wrapper = mount(CohortTableRow, {
        props: {
          item: mockVariant,
          column: 'annotations',
          isStarred: false,
          acmgClassification: null,
          hasComment: false
        },
        global: { plugins: [vuetify] }
      })

      const starIcon = wrapper.findAll('.v-icon').find((w) => w.html().includes(mdiStarOutline))!
      await starIcon.trigger('click')

      expect(wrapper.emitted('star-toggle')).toBeTruthy()
    })

    it('emits comment-click when comment icon clicked', async () => {
      const wrapper = mount(CohortTableRow, {
        props: {
          item: mockVariant,
          column: 'annotations',
          isStarred: false,
          acmgClassification: null,
          hasComment: false
        },
        global: { plugins: [vuetify] }
      })

      const commentIcon = wrapper
        .findAll('.v-icon')
        .find((w) => w.html().includes(mdiCommentOutline))!
      await commentIcon.trigger('click')

      expect(wrapper.emitted('comment-click')).toBeTruthy()
    })
  })

  describe('Variant Data Rendering', () => {
    it('renders chromosome correctly', () => {
      const wrapper = mount(CohortTableRow, {
        props: {
          item: mockVariant,
          column: 'chr',
          value: mockVariant.chr,
          isStarred: false,
          acmgClassification: null,
          hasComment: false
        },
        global: { plugins: [vuetify] }
      })

      expect(wrapper.text()).toContain('17')
    })

    it('renders gene symbol correctly', () => {
      const wrapper = mount(CohortTableRow, {
        props: {
          item: mockVariant,
          column: 'gene_symbol',
          value: mockVariant.gene_symbol,
          isStarred: false,
          acmgClassification: null,
          hasComment: false
        },
        global: { plugins: [vuetify] }
      })

      expect(wrapper.text()).toContain('BRCA1')
    })

    it('formats position with thousand separators', () => {
      const wrapper = mount(CohortTableRow, {
        props: {
          item: mockVariant,
          column: 'pos',
          value: mockVariant.pos,
          isStarred: false,
          acmgClassification: null,
          hasComment: false
        },
        global: { plugins: [vuetify] }
      })

      expect(wrapper.text()).toContain('43,044,295')
    })

    it('renders consequence with HIGH impact color', () => {
      const wrapper = mount(CohortTableRow, {
        props: {
          item: mockVariant,
          column: 'consequence',
          value: 'HIGH',
          isStarred: false,
          acmgClassification: null,
          hasComment: false
        },
        global: { plugins: [vuetify] }
      })

      const chip = wrapper.find('.v-chip')
      expect(chip.exists()).toBe(true)
      expect(chip.text()).toContain('HIGH')
    })

    it('renders functional consequence', () => {
      const wrapper = mount(CohortTableRow, {
        props: {
          item: mockVariant,
          column: 'func',
          value: 'missense_variant',
          isStarred: false,
          acmgClassification: null,
          hasComment: false
        },
        global: { plugins: [vuetify] }
      })

      expect(wrapper.text()).toContain('missense_variant')
    })

    it('formats gnomAD AF in scientific notation', () => {
      const wrapper = mount(CohortTableRow, {
        props: {
          item: mockVariant,
          column: 'gnomad_af',
          value: 0.0001,
          isStarred: false,
          acmgClassification: null,
          hasComment: false
        },
        global: { plugins: [vuetify] }
      })

      expect(wrapper.text()).toContain('1.0e-4')
    })

    it('formats gnomAD AF as decimal for values >= 0.01', () => {
      const wrapper = mount(CohortTableRow, {
        props: {
          item: mockVariant,
          column: 'gnomad_af',
          value: 0.05,
          isStarred: false,
          acmgClassification: null,
          hasComment: false
        },
        global: { plugins: [vuetify] }
      })

      expect(wrapper.text()).toContain('0.0500')
    })

    it('renders CADD score with color coding', () => {
      const wrapper = mount(CohortTableRow, {
        props: {
          item: mockVariant,
          column: 'cadd_phred',
          value: 25.5,
          isStarred: false,
          acmgClassification: null,
          hasComment: false
        },
        global: { plugins: [vuetify] }
      })

      const chip = wrapper.find('.v-chip')
      expect(chip.exists()).toBe(true)
      expect(chip.text()).toContain('25.5')
    })

    it('renders ClinVar classification with color coding', () => {
      const wrapper = mount(CohortTableRow, {
        props: {
          item: mockVariant,
          column: 'clinvar',
          value: 'Pathogenic',
          isStarred: false,
          acmgClassification: null,
          hasComment: false
        },
        global: { plugins: [vuetify] }
      })

      const chip = wrapper.find('.v-chip')
      expect(chip.exists()).toBe(true)
      expect(chip.text()).toContain('Pathogenic')
    })

    it('renders carrier count with total cases', () => {
      const wrapper = mount(CohortTableRow, {
        props: {
          item: mockVariant,
          column: 'carrier_count',
          isStarred: false,
          acmgClassification: null,
          hasComment: false
        },
        global: { plugins: [vuetify] }
      })

      expect(wrapper.text()).toContain('3 / 20')
    })

    it('formats cohort frequency as percentage', () => {
      const wrapper = mount(CohortTableRow, {
        props: {
          item: mockVariant,
          column: 'cohort_frequency',
          value: 0.15,
          isStarred: false,
          acmgClassification: null,
          hasComment: false
        },
        global: { plugins: [vuetify] }
      })

      expect(wrapper.text()).toContain('15.0%')
    })

    it('renders cDNA HGVS notation', () => {
      const wrapper = mount(CohortTableRow, {
        props: {
          item: mockVariant,
          column: 'cdna',
          value: 'c.181T>G',
          isStarred: false,
          acmgClassification: null,
          hasComment: false
        },
        global: { plugins: [vuetify] }
      })

      expect(wrapper.text()).toContain('c.181T>G')
    })

    it('renders protein change HGVS notation', () => {
      const wrapper = mount(CohortTableRow, {
        props: {
          item: mockVariant,
          column: 'aa_change',
          value: 'p.Cys61Gly',
          isStarred: false,
          acmgClassification: null,
          hasComment: false
        },
        global: { plugins: [vuetify] }
      })

      expect(wrapper.text()).toContain('p.Cys61Gly')
    })

    it('renders het/hom counts', () => {
      const wrapper = mount(CohortTableRow, {
        props: {
          item: mockVariant,
          column: 'het_count',
          isStarred: false,
          acmgClassification: null,
          hasComment: false
        },
        global: { plugins: [vuetify] }
      })

      expect(wrapper.text()).toContain('2 het / 1 hom')
    })

    it('renders het count without hom when hom is zero', () => {
      const variantNoHom = { ...mockVariant, hom_count: 0 }
      const wrapper = mount(CohortTableRow, {
        props: {
          item: variantNoHom,
          column: 'het_count',
          isStarred: false,
          acmgClassification: null,
          hasComment: false
        },
        global: { plugins: [vuetify] }
      })

      expect(wrapper.text()).toContain('2 het')
      expect(wrapper.text()).not.toContain('hom')
    })
  })

  describe('Null/Undefined Value Handling', () => {
    it('shows placeholder for null gnomAD AF', () => {
      const wrapper = mount(CohortTableRow, {
        props: {
          item: mockVariant,
          column: 'gnomad_af',
          value: null,
          isStarred: false,
          acmgClassification: null,
          hasComment: false
        },
        global: { plugins: [vuetify] }
      })

      expect(wrapper.text()).toContain('--')
    })

    it('shows placeholder for undefined gnomAD AF', () => {
      const wrapper = mount(CohortTableRow, {
        props: {
          item: mockVariant,
          column: 'gnomad_af',
          value: undefined,
          isStarred: false,
          acmgClassification: null,
          hasComment: false
        },
        global: { plugins: [vuetify] }
      })

      expect(wrapper.text()).toContain('--')
    })

    it('shows placeholder for null CADD score', () => {
      const wrapper = mount(CohortTableRow, {
        props: {
          item: mockVariant,
          column: 'cadd_phred',
          value: null,
          isStarred: false,
          acmgClassification: null,
          hasComment: false
        },
        global: { plugins: [vuetify] }
      })

      expect(wrapper.text()).toContain('--')
    })

    it('shows placeholder for null consequence', () => {
      const wrapper = mount(CohortTableRow, {
        props: {
          item: mockVariant,
          column: 'consequence',
          value: null,
          isStarred: false,
          acmgClassification: null,
          hasComment: false
        },
        global: { plugins: [vuetify] }
      })

      expect(wrapper.text()).toContain('--')
    })

    it('shows placeholder for null func', () => {
      const wrapper = mount(CohortTableRow, {
        props: {
          item: mockVariant,
          column: 'func',
          value: null,
          isStarred: false,
          acmgClassification: null,
          hasComment: false
        },
        global: { plugins: [vuetify] }
      })

      expect(wrapper.text()).toContain('--')
    })

    it('shows placeholder for null ClinVar', () => {
      const wrapper = mount(CohortTableRow, {
        props: {
          item: mockVariant,
          column: 'clinvar',
          value: null,
          isStarred: false,
          acmgClassification: null,
          hasComment: false
        },
        global: { plugins: [vuetify] }
      })

      expect(wrapper.text()).toContain('--')
    })

    it('shows placeholder for null cDNA', () => {
      const wrapper = mount(CohortTableRow, {
        props: {
          item: mockVariant,
          column: 'cdna',
          value: null,
          isStarred: false,
          acmgClassification: null,
          hasComment: false
        },
        global: { plugins: [vuetify] }
      })

      expect(wrapper.text()).toContain('--')
    })

    it('shows placeholder for null aa_change', () => {
      const wrapper = mount(CohortTableRow, {
        props: {
          item: mockVariant,
          column: 'aa_change',
          value: null,
          isStarred: false,
          acmgClassification: null,
          hasComment: false
        },
        global: { plugins: [vuetify] }
      })

      expect(wrapper.text()).toContain('--')
    })
  })

  describe('Allele Truncation', () => {
    it('truncates long ref allele with tooltip', () => {
      const longRef = 'A'.repeat(25)
      const variantLongRef = { ...mockVariant, ref: longRef }

      const wrapper = mount(CohortTableRow, {
        props: {
          item: variantLongRef,
          column: 'ref',
          value: longRef,
          isStarred: false,
          acmgClassification: null,
          hasComment: false
        },
        global: { plugins: [vuetify] }
      })

      expect(wrapper.text()).toContain('A'.repeat(20))
      expect(wrapper.text()).toContain('...')
    })

    it('does not truncate short ref allele', () => {
      const wrapper = mount(CohortTableRow, {
        props: {
          item: mockVariant,
          column: 'ref',
          value: 'A',
          isStarred: false,
          acmgClassification: null,
          hasComment: false
        },
        global: { plugins: [vuetify] }
      })

      expect(wrapper.text()).toContain('A')
      expect(wrapper.text()).not.toContain('...')
    })

    it('truncates long alt allele with tooltip', () => {
      const longAlt = 'G'.repeat(25)
      const variantLongAlt = { ...mockVariant, alt: longAlt }

      const wrapper = mount(CohortTableRow, {
        props: {
          item: variantLongAlt,
          column: 'alt',
          value: longAlt,
          isStarred: false,
          acmgClassification: null,
          hasComment: false
        },
        global: { plugins: [vuetify] }
      })

      expect(wrapper.text()).toContain('G'.repeat(20))
      expect(wrapper.text()).toContain('...')
    })

    it('does not truncate short alt allele', () => {
      const wrapper = mount(CohortTableRow, {
        props: {
          item: mockVariant,
          column: 'alt',
          value: 'G',
          isStarred: false,
          acmgClassification: null,
          hasComment: false
        },
        global: { plugins: [vuetify] }
      })

      expect(wrapper.text()).toContain('G')
      expect(wrapper.text()).not.toContain('...')
    })
  })

  describe('ClinVar chip (#469)', () => {
    const chip = (clinvar: string) =>
      mount(CohortTableRow, {
        props: {
          item: { ...mockVariant, clinvar },
          column: 'clinvar',
          value: clinvar,
          isStarred: false,
          acmgClassification: null,
          hasComment: false
        },
        global: { plugins: [vuetify] }
      }).findComponent({ name: 'VChip' })

    it('colours an abbreviation like its category', () => {
      expect(chip('LB').props('color')).toBe(chip('Likely benign').props('color'))
      expect(chip('LB').props('color')).toBe('light-green')
      expect(chip('B').props('color')).toBe('success')
      expect(chip('P').props('color')).toBe('error')
    })

    it('keeps an unknown value neutral and shows it like the case view does', () => {
      const unknown = chip('totally_made_up_term')
      expect(unknown.props('color')).toBe('grey')
      expect(unknown.text()).toBe('totally made up term')
    })
  })
})
