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
          topPhenotypes: [],
          genes: []
        })
      }
    }
  })
}))

vi.mock('../../../src/renderer/src/utils/backend-capabilities', () => ({
  getCurrentUnsupportedReason: vi.fn().mockResolvedValue(null),
  getCurrentUnsupportedReasonSync: vi.fn().mockReturnValue(null)
}))

vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

import { aliases, mdi } from 'vuetify/iconsets/mdi-svg'
import axe from 'axe-core'
import { createPinia, setActivePinia } from 'pinia'
import DatabaseOverviewDialog from '../../../src/renderer/src/components/DatabaseOverviewDialog.vue'
import DisclaimerDialog from '../../../src/renderer/src/components/DisclaimerDialog.vue'
import CaseMetadataModal from '../../../src/renderer/src/components/CaseMetadataModal.vue'
import ShortlistTable from '../../../src/renderer/src/components/shortlist/ShortlistTable.vue'
import { AppStateKey, createAppState } from '../../../src/renderer/src/composables/useAppState'
import { installCapabilities } from '../helpers/capabilities'

const vuetify = createVuetify({
  components,
  directives,
  icons: { defaultSet: 'mdi', aliases, sets: { mdi } }
})

const AXE_OPTIONS = {
  runOnly: {
    type: 'tag' as const,
    values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']
  },
  rules: {
    'color-contrast': { enabled: false },
    region: { enabled: false }
  }
}

describe('A11y WCAG 2.2 A/AA axe checks (#669)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('provides an accessible name and 0 axe violations on DatabaseOverviewDialog (#669)', async () => {
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

    const results = await axe.run(document.body, AXE_OPTIONS)
    expect(results.violations).toEqual([])
    wrapper.unmount()
  })

  it('passes WCAG 2.2 A/AA axe checks on DisclaimerDialog (#669)', async () => {
    const wrapper = mount(DisclaimerDialog, {
      global: { plugins: [vuetify] },
      attachTo: document.body
    })
    ;(wrapper.vm as unknown as { show: () => void }).show()
    await flushPromises()

    const results = await axe.run(document.body, AXE_OPTIONS)
    expect(results.violations).toEqual([])
    wrapper.unmount()
  })

  it('provides an accessible name and 0 axe violations on CaseMetadataModal (#669)', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(CaseMetadataModal, {
      props: { caseId: 1, caseName: 'case-a', variantCount: 3, createdAt: 0 },
      global: {
        plugins: [vuetify, pinia],
        stubs: {
          CaseMetadataCard: true,
          CaseCommentsTab: true,
          CaseMetricsTab: true,
          CaseDataInfoTab: true
        }
      },
      attachTo: document.body
    })
    ;(wrapper.vm as unknown as { show: () => void }).show()
    await flushPromises()

    const vDialog = wrapper.findComponent({ name: 'VDialog' })
    const el = document.body.querySelector('[aria-label="Case Metadata"]')
    expect(
      vDialog.props('ariaLabel') ??
        el?.getAttribute('aria-label') ??
        vDialog.attributes('aria-label')
    ).toBe('Case Metadata')

    const results = await axe.run(document.body, AXE_OPTIONS)
    expect(results.violations).toEqual([])
    wrapper.unmount()
  })

  it('passes WCAG 2.2 A/AA axe checks on ShortlistTable (#669)', async () => {
    installCapabilities()
    setActivePinia(createPinia())
    const state = createAppState()
    const wrapper = mount(ShortlistTable, {
      props: {
        rows: [
          {
            id: 1,
            case_id: 1,
            variant_type: 'snv',
            chr: '1',
            pos: 1000,
            ref: 'A',
            alt: 'T',
            gene_symbol: 'BRCA1',
            consequence: 'HIGH',
            cadd: 35,
            gnomad_af: 0.0001,
            clinvar: 'Pathogenic',
            is_starred: false,
            rank: 1,
            rank_score: 0.95,
            rank_components: {
              impact: 1,
              pathogenicity: 0.87,
              rarity: 0.99,
              clinvar: 1,
              phenotype: 0
            },
            rank_clinvar_pinned: true,
            rank_starred_pinned: false
          }
        ]
      },
      global: {
        plugins: [vuetify],
        provide: { [AppStateKey as symbol]: state }
      },
      attachTo: document.body
    })
    await flushPromises()

    const results = await axe.run(document.body, AXE_OPTIONS)
    expect(results.violations).toEqual([])
    wrapper.unmount()
  })
})
