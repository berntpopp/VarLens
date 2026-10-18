import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

vi.mock('../../../src/renderer/src/composables/useApiService', () => ({
  useApiService: () => ({
    api: {
      database: {
        getOverview: vi.fn().mockResolvedValue({
          summary: {
            case_count: 1,
            variant_count: 10,
            starred_variants: 0,
            acmg_counts: {}
          },
          cohortGroups: [],
          tags: [],
          phenotypes: [],
          genes: []
        })
      }
    }
  })
}))

vi.mock('../../../src/renderer/src/utils/backend-capabilities', () => ({
  getCurrentUnsupportedReason: vi.fn().mockResolvedValue(null)
}))

vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

import DatabaseOverviewDialog from '../../../src/renderer/src/components/DatabaseOverviewDialog.vue'

const vuetify = createVuetify({ components, directives })

describe('DatabaseOverviewDialog a11y (#669)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('provides an accessible name via aria-label on the dialog (#669)', async () => {
    const wrapper = mount(DatabaseOverviewDialog, {
      global: {
        plugins: [vuetify],
        stubs: {
          OverviewStatsGrid: true,
          OverviewCohortSection: true,
          OverviewTagsSection: true,
          OverviewPhenotypesSection: true,
          OverviewGenesSection: true
        }
      },
      attachTo: document.body
    })
    ;(wrapper.vm as unknown as { show: () => void }).show()
    await flushPromises()

    const vDialog = wrapper.findComponent({ name: 'VDialog' })
    const el = document.body.querySelector('[aria-label="Database Overview"]')
    expect(
      vDialog.props('ariaLabel') ??
        el?.getAttribute('aria-label') ??
        vDialog.attributes('aria-label')
    ).toBe('Database Overview')
    wrapper.unmount()
  })
})
