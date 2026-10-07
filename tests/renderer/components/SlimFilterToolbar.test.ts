import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import SlimFilterToolbar from '../../../src/renderer/src/components/SlimFilterToolbar.vue'

const vuetify = createVuetify({ components, directives })

const baseProps = {
  filteredCount: 10,
  totalCount: 100,
  hasActiveFilters: true,
  activeFilterCount: 1,
  activeFiltersList: [{ id: 'gene', label: 'Gene', value: 'BRCA2' }]
}

function mountToolbar(props: Record<string, unknown> = baseProps) {
  return mount(SlimFilterToolbar, {
    props: props as typeof baseProps,
    attachTo: document.body,
    global: { plugins: [vuetify] },
    slots: { filters: '<input class="search-input" />' }
  })
}

describe('SlimFilterToolbar loading stability', () => {
  it('keeps the applied-filters row rendered when no filters are active (reserved height)', () => {
    const wrapper = mountToolbar({
      ...baseProps,
      hasActiveFilters: false,
      activeFilterCount: 0,
      activeFiltersList: []
    })
    const bar = wrapper.find('.applied-filters-bar')
    expect(bar.exists()).toBe(true)
    expect(bar.classes()).toContain('applied-filters-bar--empty')
    wrapper.unmount()
  })

  it('moves focus to the search input when Clear removes the focused control', async () => {
    // Like the real parents, empty the filter list synchronously on clear-all,
    // which unmounts the focused "Clear all" button.
    const wrapper: ReturnType<typeof mountToolbar> = mountToolbar({
      ...baseProps,
      'onClear-all': () => {
        void wrapper.setProps({
          hasActiveFilters: false,
          activeFilterCount: 0,
          activeFiltersList: []
        })
      }
    })
    const clearAll = wrapper.findAll('.applied-filters-bar button').at(-1)!
    ;(clearAll.element as HTMLElement).focus()
    await clearAll.trigger('click')
    await nextTick()
    await nextTick()

    expect(wrapper.emitted('clear-all')).toHaveLength(1)
    expect(document.activeElement?.classList.contains('search-input')).toBe(true)
    wrapper.unmount()
  })
})

describe('SlimFilterToolbar total while the summary is rebuilt', () => {
  it('marks the total as being refreshed, in text for assistive technology too', () => {
    const wrapper = mountToolbar({ ...baseProps, totalCountStale: true })
    const mark = wrapper.find('[data-testid="total-refreshing"]')
    expect(mark.exists()).toBe(true)
    expect(wrapper.find('.results-chip').attributes('aria-label')).toBe(
      '10 of 100 variants shown; the total is being refreshed'
    )
    wrapper.unmount()
  })

  it('shows the plain total otherwise (the case view never passes the flag)', () => {
    const wrapper = mountToolbar()
    expect(wrapper.find('[data-testid="total-refreshing"]').exists()).toBe(false)
    expect(wrapper.find('.results-chip').attributes('aria-label')).toBe('10 of 100 variants shown')
    wrapper.unmount()
  })
})
