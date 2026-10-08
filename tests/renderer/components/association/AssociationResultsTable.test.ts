import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import AssociationResultsTable from '../../../../src/renderer/src/components/association/AssociationResultsTable.vue'
import { BURDEN_REFERENCE_NOTE } from '../../../../src/renderer/src/utils/association-results'

const vuetify = createVuetify({ components, directives })

const result = {
  gene_symbol: 'GENE1',
  n_variants: 2,
  sites_excluded: { missing_call: 2, conflicting_calls: 1, no_called_alleles: 0 },
  groupA_carriers: 3,
  groupB_carriers: 1,
  groupA_total: 5,
  groupB_total: 5,
  fisher: { p_value: 0.04, odds_ratio: 6, ci_lower: null, ci_upper: null },
  logistic_burden: {
    p_value: 0.03,
    beta: 1.2,
    se: 0.5,
    ci_lower: 0.2,
    ci_upper: 2.2,
    used_firth: false
  },
  q_value: 0.08
}

describe('AssociationResultsTable', () => {
  it('states the reference assumption and shows the excluded sites of each gene', () => {
    const wrapper = mount(AssociationResultsTable, {
      global: { plugins: [vuetify, createPinia()] },
      props: { results: [result], primaryTest: 'fisher' }
    })

    expect(wrapper.get('[data-testid="burden-reference-note"]').text()).toBe(BURDEN_REFERENCE_NOTE)
    const excluded = wrapper.get('[data-testid="sites-excluded"]')
    expect(excluded.text()).toBe('3')
    expect(excluded.attributes('title')).toBe(
      'Missing call: 2, conflicting calls: 1, no called alleles: 0'
    )
    expect(wrapper.find('[data-testid="burden-non-autosomal-note"]').exists()).toBe(false)
  })

  it('an empty result on chrX says why it is empty', () => {
    const wrapper = mount(AssociationResultsTable, {
      global: { plugins: [vuetify, createPinia()] },
      props: { results: [], primaryTest: 'fisher', nonAutosomalVariants: 2 }
    })
    expect(wrapper.get('[data-testid="burden-non-autosomal-note"]').text()).toBe(
      '2 qualifying variants were left out because they are not on chromosomes 1-22.'
    )
  })
})
