import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import BatchSummaryPhase from '../../../../src/renderer/src/components/batch-import/BatchSummaryPhase.vue'

const vuetify = createVuetify({ components, directives })

const detail = (caseName: string, unrankedClinvar?: string[]) => ({
  index: 0,
  totalFiles: 2,
  fileName: `${caseName}.json`,
  caseName,
  status: 'success' as const,
  variantCount: 10,
  ...(unrankedClinvar !== undefined ? { unrankedClinvar } : {})
})

const mountSummary = (details: unknown[]) =>
  mount(BatchSummaryPhase, {
    props: {
      summary: { succeeded: details.length, failed: 0, skipped: 0, cancelled: false, details }
    },
    global: { plugins: [vuetify] }
  })

describe('BatchSummaryPhase: unrecognised ClinVar values (#469)', () => {
  it('shows nothing when every value was recognised', () => {
    const wrapper = mountSummary([detail('fine')])
    expect(wrapper.find('[data-testid="unranked-clinvar"]').exists()).toBe(false)
  })

  it('warns per file with the count and the values as the table shows them', () => {
    const wrapper = mountSummary([
      detail('sevA', ['totally_made_up_term', 'reviewed: fine']),
      detail('fine')
    ])
    const notices = wrapper.findAll('[data-testid="unranked-clinvar"]')
    expect(notices).toHaveLength(1)
    const text = notices[0].text()
    expect(text).toContain('sevA')
    expect(text).toContain('2 ClinVar values not recognised')
    expect(text).toContain('totally made up term')
    expect(text).toContain('reviewed: fine')
    // A warning alert with a tonal, theme-derived background.
    const alert = wrapper.findComponent({ name: 'VAlert' })
    expect(alert.props('type')).toBe('warning')
    expect(alert.props('variant')).toBe('tonal')
    expect(wrapper.html()).not.toContain('surface-variant')
  })

  it('truncates a long list', () => {
    const many = Array.from({ length: 14 }, (_, index) => `odd_${index}`)
    const text = mountSummary([detail('big', many)])
      .find('[data-testid="unranked-clinvar"]')
      .text()
    expect(text).toContain('14 ClinVar values not recognised')
    expect(text).toContain('odd 0')
    expect(text).toContain('and 6 more')
    expect(text).not.toContain('odd 13')
  })
})
