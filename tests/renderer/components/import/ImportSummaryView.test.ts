import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import { IMPORT_MESSAGES } from '../../../../src/shared/config/import.config'
import ImportSummaryView from '../../../../src/renderer/src/components/import/ImportSummaryView.vue'

const vuetify = createVuetify({ components, directives })

const mountSummary = (unrankedClinvar?: string[], afOutOfRange?: number) =>
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
        ...(unrankedClinvar !== undefined ? { unrankedClinvar } : {}),
        ...(afOutOfRange !== undefined ? { afOutOfRange } : {})
      }
    },
    global: { plugins: [vuetify] }
  })

describe('ImportSummaryView: unrecognised ClinVar values (#469)', () => {
  it('shows nothing when every value was recognised', () => {
    expect(mountSummary().find('[data-testid="import-data-warnings"]').exists()).toBe(false)
    expect(mountSummary([]).find('[data-testid="import-data-warnings"]').exists()).toBe(false)
  })

  it('names the count and the values, formatted like table cells', () => {
    const notice = mountSummary(['totally_made_up_term', 'odd_one']).find(
      '[data-testid="import-data-warnings"]'
    )
    expect(notice.exists()).toBe(true)
    expect(notice.text()).toContain('2 ClinVar values not recognised')
    expect(notice.text()).toContain('totally made up term, odd one')
  })

  it('warns about gnomAD AF values outside [0, 1] next to the ClinVar notice', () => {
    const notices = mountSummary(['odd_one'], 3).findAll('[data-testid="import-data-warnings"]')
    expect(notices.map((notice) => notice.text())).toEqual([
      expect.stringContaining('1 ClinVar value not recognised'),
      `trio: ${IMPORT_MESSAGES.afOutOfRange(3)}`
    ])
  })
})
