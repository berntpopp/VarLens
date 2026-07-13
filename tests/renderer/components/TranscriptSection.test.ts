/**
 * Component tests for TranscriptSection.vue — the shared transcript table used by
 * both the case view and the cohort view (`mode: 'case' | 'cohort'`).
 *
 * Post-D1/D2, `variant_transcripts.consequence` holds the canonical IMPACT level
 * (HIGH/MODERATE/LOW/MODIFIER) for ALL import paths (VCF and JSON), and
 * `variant_transcripts.func` holds the Sequence Ontology term. These tests lock
 * down that:
 *   1. The impact chip colors correctly off the canonical `consequence` field for
 *      DB-imported rows (case mode) regardless of import source.
 *   2. The SO term (`func`) is surfaced to the user (via the consequence tooltip),
 *      not silently dropped.
 *   3. Cohort mode (VEP-sourced rows only — DB transcripts never populate; see
 *      VariantDetailsPanel.vue passing `variant-id: null` in cohort mode) renders
 *      identical chip + func semantics via the same shared component.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import TranscriptSection from '../../../src/renderer/src/components/TranscriptSection.vue'
import { createMockApi } from '../../utils/mock-api'
import type { TranscriptAnnotation } from '../../../src/shared/types/transcript'
import type { VepTranscriptConsequence } from '../../../src/shared/types/vep'

const vuetify = createVuetify({ components, directives })

/** Minimal DB transcript row (shape returned by transcripts:list for both VCF- and JSON-imported cases). */
function makeDbTranscript(overrides: Partial<TranscriptAnnotation> = {}): TranscriptAnnotation {
  return {
    id: 1,
    variant_id: 1,
    transcript_id: 'ENST00000357654',
    gene_symbol: 'BRCA1',
    consequence: 'MODERATE',
    func: 'missense_variant',
    cdna: 'c.123A>G',
    aa_change: 'p.Arg41Gly',
    hpo_sim_score: null,
    moi: null,
    is_selected: true,
    is_mane_select: null,
    is_canonical: null,
    ...overrides
  }
}

/** Minimal VEP transcript consequence (cohort mode's only transcript source). */
function makeVepTranscript(
  overrides: Partial<VepTranscriptConsequence> = {}
): VepTranscriptConsequence {
  return {
    transcript_id: 'ENST00000222222',
    gene_symbol: 'BRCA1',
    consequence_terms: ['missense_variant'],
    impact: 'MODERATE',
    ...overrides
  }
}

describe('TranscriptSection', () => {
  beforeEach(() => {
    window.api = createMockApi()
  })

  async function mountCase(dbRows: TranscriptAnnotation[]) {
    window.api.transcripts.list.mockResolvedValue(dbRows)
    const wrapper = mount(TranscriptSection, {
      props: {
        variantId: 1,
        vepTranscripts: [],
        vepLoading: false,
        mode: 'case' as const
      },
      global: { plugins: [vuetify] }
    })
    await flushPromises()
    await wrapper.vm.$nextTick()
    return wrapper
  }

  function mountCohort(vepRows: VepTranscriptConsequence[]) {
    return mount(TranscriptSection, {
      props: {
        variantId: null,
        vepTranscripts: vepRows,
        vepLoading: false,
        mode: 'cohort' as const
      },
      global: { plugins: [vuetify] }
    })
  }

  it('colors the impact chip from the canonical IMPACT field for a DB-imported transcript row', async () => {
    const wrapper = await mountCase([makeDbTranscript({ consequence: 'MODERATE' })])

    const chip = wrapper.findAll('.v-chip').find((c) => c.text() === 'MODERATE')
    expect(chip?.exists()).toBe(true)
    expect(chip!.classes()).toContain('text-warning')
  })

  it('surfaces the func (SO term) for a DB-imported transcript row via the consequence tooltip', async () => {
    const wrapper = await mountCase([
      makeDbTranscript({ consequence: 'MODERATE', func: 'missense_variant' })
    ])

    const tooltip = wrapper.findComponent({ name: 'VTooltip' })
    expect(tooltip.exists()).toBe(true)
    expect(tooltip.props('text')).toBe('missense_variant')
  })

  it('renders identical chip + func semantics for a HIGH-impact DB row (import source agnostic)', async () => {
    const wrapper = await mountCase([
      makeDbTranscript({ consequence: 'HIGH', func: 'stop_gained' })
    ])

    const chip = wrapper.findAll('.v-chip').find((c) => c.text() === 'HIGH')
    expect(chip?.exists()).toBe(true)
    expect(chip!.classes()).toContain('text-error')

    const tooltip = wrapper.findComponent({ name: 'VTooltip' })
    expect(tooltip.props('text')).toBe('stop_gained')
  })

  it('does not lose information when func is null (no tooltip text, chip still colors)', async () => {
    const wrapper = await mountCase([makeDbTranscript({ consequence: 'LOW', func: null })])

    const chip = wrapper.findAll('.v-chip').find((c) => c.text() === 'LOW')
    expect(chip?.exists()).toBe(true)
    expect(chip!.classes()).toContain('text-info')
  })

  it('cohort mode (VEP-sourced row) renders identical chip + func semantics as case mode', () => {
    const wrapper = mountCohort([
      makeVepTranscript({ impact: 'MODERATE', consequence_terms: ['missense_variant'] })
    ])

    const chip = wrapper.findAll('.v-chip').find((c) => c.text() === 'MODERATE')
    expect(chip?.exists()).toBe(true)
    expect(chip!.classes()).toContain('text-warning')

    const tooltip = wrapper.findComponent({ name: 'VTooltip' })
    expect(tooltip.props('text')).toBe('missense_variant')
  })
})
