/**
 * The overview tiles that come from the cohort summary say so while that
 * summary is being rebuilt: a counter is either exact or marked.
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import OverviewStatsGrid from '../../../src/renderer/src/components/database-overview/OverviewStatsGrid.vue'

const vuetify = createVuetify({ components, directives })
const summary = {
  total_cases: 3,
  total_variants: 180,
  unique_variants: 120,
  avg_variants_per_case: 60,
  genes_with_variants: 40,
  starred_variants: 0,
  acmg_counts: { pathogenic: 0, likely_pathogenic: 0, vus: 0, likely_benign: 0, benign: 0 }
}

function mountGrid(props: Record<string, unknown>) {
  return mount(OverviewStatsGrid, {
    props: { summary, ...props } as never,
    global: { plugins: [vuetify] }
  })
}

describe('OverviewStatsGrid', () => {
  it('shows plain figures when the summary is current', () => {
    const wrapper = mountGrid({})
    expect(wrapper.findAll('[data-testid="summary-refreshing"]')).toHaveLength(0)
    expect(wrapper.text()).toContain('120')
  })

  it('marks the tiles taken from the cohort summary as being refreshed', () => {
    const wrapper = mountGrid({ summaryStale: true })
    const marks = wrapper.findAll('[data-testid="summary-refreshing"]')
    // Unique variants and genes with variants; the case and variant totals
    // come from the cases themselves and stay unmarked.
    expect(marks).toHaveLength(2)
    expect(marks[0].text()).toContain('Being refreshed')
    expect(marks[0].attributes('role')).toBe('status')
    const tiles = wrapper.findAll('.v-card').map((card) => card.text())
    expect(tiles.find((text) => text.includes('Unique Variants'))).toContain('Being refreshed')
    expect(tiles.find((text) => text.includes('Genes with Variants'))).toContain('Being refreshed')
    expect(tiles.find((text) => text.includes('Total Cases'))).not.toContain('Being refreshed')
    expect(tiles.find((text) => text.includes('Total Variants'))).not.toContain('Being refreshed')
  })
})
