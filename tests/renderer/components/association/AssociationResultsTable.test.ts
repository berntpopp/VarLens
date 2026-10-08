import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import AssociationResultsTable from '../../../../src/renderer/src/components/association/AssociationResultsTable.vue'
import { createVuetify } from 'vuetify'

const vuetify = createVuetify()

describe('AssociationResultsTable', () => {
  it('renders Sites column calculating correctly', () => {
    const results = [
      {
        gene_symbol: 'BRCA1',
        n_variants: 10,
        sites_excluded: 2,
        groupA_carriers: 1,
        groupB_carriers: 2,
        groupA_total: 10,
        groupB_total: 10,
        fisher: { p_value: 0.1, odds_ratio: 1, ci_lower: 0.5, ci_upper: 1.5 },
        logistic_burden: {
          p_value: 0.2,
          beta: 0.5,
          se: 0.1,
          ci_lower: 0.1,
          ci_upper: 0.9,
          used_firth: false
        },
        q_value: 0.5
      }
    ]

    const wrapper = mount(AssociationResultsTable as any, {
      props: { results, primaryTest: 'fisher' },
      global: {
        plugins: [createPinia(), vuetify]
      }
    })

    const html = wrapper.html()
    expect(html).toContain('BRCA1')
    expect(html).toContain('8') // 10 - 2
  })
})
