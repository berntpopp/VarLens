import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import FilterEmptyState from '../../../../src/renderer/src/components/filters/FilterEmptyState.vue'
import { FILTER_EMPTY_STATE_COPY } from '../../../../src/renderer/src/config/uiCopyConfig'

const vuetify = createVuetify({ components, directives })

const FILTERS = [
  { id: 'frequency', label: 'AF', value: '<= 1%' },
  { id: 'impact', label: 'Impact', value: 'HIGH' },
  { id: 'col:cadd', label: 'CADD', value: '>= 20' }
]

function mountWith(filters: typeof FILTERS) {
  return mount(FilterEmptyState, { global: { plugins: [vuetify] }, props: { filters } })
}

describe('FilterEmptyState (#568)', () => {
  it('lists every active filter clause', () => {
    const text = mountWith(FILTERS).text()
    expect(text).toContain(FILTER_EMPTY_STATE_COPY.title)
    for (const f of FILTERS) {
      expect(text).toContain(f.label)
      expect(text).toContain(f.value)
    }
  })

  it('removes one clause per click, by its id', async () => {
    const wrapper = mountWith(FILTERS)
    const buttons = wrapper.findAll('.v-chip__close')
    expect(buttons).toHaveLength(FILTERS.length)
    expect(buttons[2].attributes('aria-label')).toBe('Remove filter: CADD >= 20')
    await buttons[2].trigger('click')
    expect(wrapper.emitted('remove')).toEqual([['col:cadd']])
  })

  it('offers clear-all when filters are active', async () => {
    const wrapper = mountWith(FILTERS)
    await wrapper.get('[data-testid="filter-empty-state-clear-all"]').trigger('click')
    expect(wrapper.emitted('clear-all')).toHaveLength(1)
  })

  it('says there is nothing to show, without filter actions, when no filter is active', () => {
    const wrapper = mountWith([])
    expect(wrapper.text()).toContain(FILTER_EMPTY_STATE_COPY.noFiltersTitle)
    expect(wrapper.find('[data-testid="filter-empty-state-clear-all"]').exists()).toBe(false)
  })

  // Case/cohort parity guard: both tables render the same empty state.
  it.each([
    'src/renderer/src/components/VariantTable.vue',
    'src/renderer/src/components/cohort/CohortDataTable.vue'
  ])('%s renders FilterEmptyState in its no-data slot', (file) => {
    expect(readFileSync(file, 'utf8')).toMatch(/#no-data>[\s\S]*<FilterEmptyState/)
  })
})
