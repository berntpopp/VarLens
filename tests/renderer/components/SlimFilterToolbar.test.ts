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

describe('SlimFilterToolbar count label', () => {
  it('names the total when there is one, and only the shown count otherwise', () => {
    const wrapper = mountToolbar()
    expect(wrapper.find('.results-chip').attributes('aria-label')).toBe('10 of 100 variants shown')
    wrapper.unmount()
    const noTotal = mountToolbar({ ...baseProps, totalCount: null })
    expect(noTotal.find('.results-chip').attributes('aria-label')).toBe('10 variants shown')
    noTotal.unmount()
  })
})

describe('SlimFilterToolbar on a phone', () => {
  it('keeps the whole count and every action on screen: bare count, icon-only Clear/Filters', () => {
    const width = window.innerWidth
    window.innerWidth = 390
    const wrapper = mount(SlimFilterToolbar, {
      props: baseProps,
      global: { plugins: [createVuetify({ components, directives })] }
    })
    window.innerWidth = width
    const chip = wrapper.find('.results-chip')
    expect(chip.text()).toContain('10')
    expect(chip.text()).not.toContain('100')
    expect(chip.attributes('aria-label')).toBe('10 of 100 variants shown')
    for (const name of ['Clear', 'Filters']) {
      const button = wrapper.find(`button[aria-label="${name}"]`)
      expect(button.exists()).toBe(true)
      expect(button.text()).not.toContain(name)
    }
    wrapper.unmount()
  })
})

describe('SlimFilterToolbar Copy Sign-Out', () => {
  it('renders copy-sign-out menu when enabled and emits format on click', async () => {
    const orig = window.innerWidth
    window.innerWidth = 1440
    const vuetifyWide = createVuetify({
      components,
      directives,
      display: {
        mobileBreakpoint: 'sm',
        thresholds: { xs: 0, sm: 600, md: 960, lg: 1280, xl: 1920 }
      }
    })
    const wrapper = mount(SlimFilterToolbar, {
      props: {
        ...baseProps,
        showSignOut: true
      },
      attachTo: document.body,
      global: { plugins: [vuetifyWide] }
    })
    window.innerWidth = orig
    const btn = wrapper.find('[data-testid="copy-sign-out-menu"]')
    expect(btn.exists()).toBe(true)
    await btn.trigger('click')
    await nextTick()
    const tsvItem = document.querySelector<HTMLElement>('[data-testid="copy-sign-out-tsv"]')
    expect(tsvItem).not.toBeNull()
    tsvItem!.click()
    await nextTick()
    expect(wrapper.emitted('copy-sign-out')).toEqual([['tsv']])
    wrapper.unmount()
  })

  it('does not render copy-sign-out menu when disabled/omitted', () => {
    const wrapper = mountToolbar({
      ...baseProps
    })
    const btn = wrapper.find('[data-testid="copy-sign-out-menu"]')
    expect(btn.exists()).toBe(false)
    wrapper.unmount()
  })
})
