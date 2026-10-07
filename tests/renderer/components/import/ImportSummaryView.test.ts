import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import ImportSummaryView from '../../../../src/renderer/src/components/import/ImportSummaryView.vue'

const vuetify = createVuetify({ components, directives })

const mountSummary = (unrankedClinvar?: string[]) =>
  mount(ImportSummaryView, {
    props: {
      caseName: 'trio',
      fileResults: [],
      result: {
        caseId: 1,
        totalVariants: 10,
        totalSkipped: 0,
        elapsed: 5,
        files: [{ filePath: '/x/trio.vcf', variantType: 'snv', variantCount: 10 }],
        ...(unrankedClinvar !== undefined ? { unrankedClinvar } : {})
      }
    },
    global: { plugins: [vuetify] }
  })

describe('ImportSummaryView: unrecognised ClinVar values (#469)', () => {
  it('shows nothing when every value was recognised', () => {
    expect(mountSummary().find('[data-testid="unranked-clinvar"]').exists()).toBe(false)
    expect(mountSummary([]).find('[data-testid="unranked-clinvar"]').exists()).toBe(false)
  })

  it('names the count and the values, formatted like table cells', () => {
    const notice = mountSummary(['totally_made_up_term', 'odd_one']).find(
      '[data-testid="unranked-clinvar"]'
    )
    expect(notice.exists()).toBe(true)
    expect(notice.text()).toContain('2 ClinVar values not recognised')
    expect(notice.text()).toContain('totally made up term, odd one')
  })
})
