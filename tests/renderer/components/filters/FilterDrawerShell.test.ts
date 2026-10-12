import { afterEach, describe, expect, it, vi } from 'vitest'
import { h, nextTick, ref } from 'vue'
import { mount, enableAutoUnmount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

const viewportWidth = ref(1920)

vi.mock('vuetify', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vuetify')>()),
  useDisplay: () => ({ width: viewportWidth })
}))

import { VLayout, VNavigationDrawer } from 'vuetify/components'
import FilterDrawerShell from '../../../../src/renderer/src/components/filters/FilterDrawerShell.vue'

const STORAGE_KEY = 'varlens_filter_drawer_width'

function mountDrawer() {
  return mount(
    {
      render: () =>
        h(VLayout, () =>
          h(FilterDrawerShell, {
            open: true,
            activeFilterCount: 0,
            expandedPanels: [],
            allPanelValues: []
          })
        )
    },
    { global: { plugins: [createVuetify({ components, directives })] } }
  )
}

describe('FilterDrawerShell width', () => {
  enableAutoUnmount(afterEach)
  afterEach(() => localStorage.clear())

  it('goes full width when narrow and restores the stored preference on widening', async () => {
    localStorage.setItem(STORAGE_KEY, '450')
    viewportWidth.value = 1920
    const wrapper = mountDrawer()
    const drawer = () => wrapper.findComponent(VNavigationDrawer)
    expect(drawer().props('width')).toBe(450)

    for (const [width, expected] of [
      [390, 390],
      [512, 512],
      [768, 307],
      [1024, 409]
    ]) {
      viewportWidth.value = width
      await nextTick()
      expect(drawer().props('width')).toBe(expected)
    }

    viewportWidth.value = 1920
    await nextTick()
    expect(drawer().props('width')).toBe(450)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('450')
  })

  it('hides the resize handle while full width', async () => {
    viewportWidth.value = 390
    const wrapper = mountDrawer()
    expect(wrapper.find('.filter-drawer-resize-handle').exists()).toBe(false)
    viewportWidth.value = 1920
    await nextTick()
    expect(wrapper.find('.filter-drawer-resize-handle').exists()).toBe(true)
  })
})

describe('FilterDrawerShell route changes', () => {
  it('stays open when a filter change writes the URL query', async () => {
    const { createRouter, createMemoryHistory } = await import('vue-router')
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { render: () => null } }]
    })
    await router.push('/')
    const onUpdate = vi.fn()
    mount(
      {
        render: () =>
          h(VLayout, () =>
            h(FilterDrawerShell, {
              open: true,
              activeFilterCount: 0,
              expandedPanels: [],
              allPanelValues: [],
              'onUpdate:open': onUpdate
            })
          )
      },
      { global: { plugins: [createVuetify({ components, directives }), router] } }
    )
    await router.push({ path: '/', query: { f: '{"impact":["HIGH"]}' } })
    await nextTick()
    expect(onUpdate).not.toHaveBeenCalledWith(false)
  })
})

describe('FilterDrawerShell keyboard', () => {
  it('moves focus to the title on open and closes on Escape', async () => {
    const onUpdate = vi.fn()
    const open = ref(false)
    const wrapper = mount(
      {
        render: () =>
          h(VLayout, () =>
            h(FilterDrawerShell, {
              open: open.value,
              activeFilterCount: 0,
              expandedPanels: [],
              allPanelValues: [],
              'onUpdate:open': onUpdate
            })
          )
      },
      { attachTo: document.body, global: { plugins: [createVuetify({ components, directives })] } }
    )
    open.value = true
    await nextTick()
    await nextTick()
    expect(document.activeElement?.textContent?.trim()).toBe('All Filters')
    await wrapper.find('.v-navigation-drawer').trigger('keydown', { key: 'Escape' })
    expect(onUpdate).toHaveBeenCalledWith(false)
  })
  it('leaves Escape to a menu open inside the drawer', async () => {
    const onUpdate = vi.fn()
    const wrapper = mount(
      {
        render: () =>
          h(VLayout, () =>
            h(FilterDrawerShell, {
              open: true,
              activeFilterCount: 0,
              expandedPanels: [],
              allPanelValues: [],
              'onUpdate:open': onUpdate
            })
          )
      },
      { attachTo: document.body, global: { plugins: [createVuetify({ components, directives })] } }
    )
    const menu = document.createElement('div')
    menu.className = 'v-menu v-overlay--active'
    document.body.appendChild(menu)
    await wrapper.find('.v-navigation-drawer').trigger('keydown', { key: 'Escape' })
    menu.remove()
    expect(onUpdate).not.toHaveBeenCalledWith(false)
  })
})
