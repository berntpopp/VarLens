/**
 * Phenotype column (spec .planning/specs/2026-10-15-phenotype-column.md): the
 * cell shows the stored score and best disease, the tooltip fetches the
 * explanation once per case and gene on first hover, and the column is shown
 * by default only for a case with present HPO terms (an explicit choice wins).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import PhenotypeScoreCell from '@renderer/components/variant-table/PhenotypeScoreCell.vue'
import {
  explainPhenotype,
  usePhenotypeRefresh,
  withPhenotypeDefault
} from '@renderer/components/variant-table/usePhenotypeColumn'
import { notifyPhenotypeChanged } from '@renderer/composables/phenotypeChanges'
import { phenotypeLines } from '@renderer/components/shortlist/rank-tooltip-phenotype'
import { baseHeaders as caseHeaders } from '@renderer/components/variant-table/columns'
import { baseHeaders as cohortHeaders } from '@renderer/components/cohort/useCohortColumns'
import { EMPTY_VALUE_PLACEHOLDER } from '@renderer/config/displayConfig'
import type { HpoExplanation } from '../../../../src/shared/types/hpo-profile'

const vuetify = createVuetify({ components, directives })

const HPO: HpoExplanation = {
  score: 0.65,
  percentile: 0.9,
  diseaseId: 'OMIM:607208',
  diseaseLabel: 'Dravet syndrome',
  matched: [],
  conflicts: [],
  notConflicts: []
}

const explainGene = vi.fn(async () => HPO)
const getFullMetadata = vi.fn()

beforeEach(() => {
  notifyPhenotypeChanged(null) // fresh explanation cache per test
  explainGene.mockClear()
  ;(window as { api?: unknown }).api = {
    hpoData: { explainGene },
    caseMetadata: { getFullMetadata }
  }
})
afterEach(() => {
  delete (window as { api?: unknown }).api
  document.body.innerHTML = ''
})

const mountCell = (row: Record<string, unknown>, caseId: number | null = 1) =>
  mount(PhenotypeScoreCell, {
    props: { caseId, row },
    global: { plugins: [vuetify] },
    attachTo: document.body
  })

describe('PhenotypeScoreCell', () => {
  it('shows the score with two decimals and the best disease', () => {
    const wrapper = mountCell({
      gene_symbol: 'SCN1A',
      phenotype_score: 0.6459,
      phenotype_disease: 'Dravet syndrome'
    })
    expect(wrapper.text()).toContain('0.65')
    expect(wrapper.get('.phenotype-cell__disease').text()).toBe('Dravet syndrome')
  })

  it('shows the placeholder without a score', () => {
    const wrapper = mountCell({ gene_symbol: 'OTHER', phenotype_score: null })
    expect(wrapper.find('.phenotype-cell').exists()).toBe(false)
    expect(wrapper.text()).toBe(EMPTY_VALUE_PLACEHOLDER)
  })

  it('fetches the explanation on first hover only and shows its lines', async () => {
    const wrapper = mountCell({ gene_symbol: 'SCN1A', phenotype_score: 0.65 })
    expect(explainGene).not.toHaveBeenCalled()
    await wrapper.get('.phenotype-cell').trigger('mouseenter')
    await flushPromises()
    await wrapper.get('.phenotype-cell').trigger('mouseenter')
    expect(explainGene).toHaveBeenCalledTimes(1)
    expect(explainGene).toHaveBeenCalledWith(1, 'SCN1A')
    expect(document.body.textContent).toContain(phenotypeLines(HPO).title)
  })

  it('caches per case and gene until the terms change', async () => {
    await explainPhenotype(1, 'SCN1A')
    await explainPhenotype(1, 'SCN1A')
    expect(explainGene).toHaveBeenCalledTimes(1)
    notifyPhenotypeChanged(1)
    await explainPhenotype(1, 'SCN1A')
    expect(explainGene).toHaveBeenCalledTimes(2)
  })

  it('has no explanation in the cohort view', async () => {
    const wrapper = mountCell({ gene_symbol: 'SCN1A', phenotype_score: 0.65 }, null)
    await wrapper.get('.phenotype-cell').trigger('mouseenter')
    expect(explainGene).not.toHaveBeenCalled()
  })
})

describe('phenotype column registry and default visibility', () => {
  it('is a sortable column in the case and the cohort table', () => {
    expect(caseHeaders.find((h) => h.key === 'phenotype_score')).toMatchObject({
      title: 'Phenotype',
      sortable: true
    })
    expect(cohortHeaders.find((h) => h.key === 'phenotype_score')).toMatchObject({
      title: 'Best phenotype match (carriers)',
      sortable: true
    })
  })

  it('is hidden without present HPO terms unless the user chose it', async () => {
    const terms = (excluded: boolean) => ({
      hpoTerms: [{ hpo_id: 'HP:1', hpo_label: 'x', excluded, key: false }]
    })
    getFullMetadata.mockImplementation(async (caseId: number) =>
      caseId === 1 ? terms(false) : terms(true)
    )
    const visibility = (caseId: number, explicit: Record<string, boolean> = {}) => {
      const prefs = ref({ order: [], visibility: explicit, widths: {} })
      const effective = withPhenotypeDefault(prefs, () => caseId)
      return () => effective.value.visibility.phenotype_score
    }
    const withTerms = visibility(1)
    const excludedOnly = visibility(2)
    const chosen = visibility(2, { phenotype_score: true })
    await flushPromises()
    expect(withTerms()).toBeUndefined() // responsive default applies
    expect(excludedOnly()).toBe(false)
    expect(chosen()).toBe(true)
  })
})

describe('usePhenotypeRefresh', () => {
  it('reloads on its case or an HPO data change and reports progress', async () => {
    let finish: () => void = () => {}
    const reload = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    const refreshing = usePhenotypeRefresh(() => 1, reload)
    notifyPhenotypeChanged(2) // another case
    await flushPromises()
    expect(reload).not.toHaveBeenCalled()
    notifyPhenotypeChanged(1)
    await flushPromises()
    expect(reload).toHaveBeenCalledTimes(1)
    expect(refreshing.value).toBe(true)
    finish()
    await flushPromises()
    expect(refreshing.value).toBe(false)
    notifyPhenotypeChanged(null) // HPO data installed
    await flushPromises()
    expect(reload).toHaveBeenCalledTimes(2)
  })
})
