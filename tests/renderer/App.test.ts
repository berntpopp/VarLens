import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

const { useShellNavigationSpy, useShellLifecycleSpy } = vi.hoisted(() => ({
  useShellNavigationSpy: vi.fn(),
  useShellLifecycleSpy: vi.fn()
}))

vi.mock(
  '../../src/renderer/src/composables/useShellNavigation',
  () => ({
    useShellNavigation: useShellNavigationSpy
  }),
  { virtual: true }
)

vi.mock(
  '../../src/renderer/src/composables/useShellLifecycle',
  () => ({
    useShellLifecycle: useShellLifecycleSpy
  }),
  { virtual: true }
)

import App from '../../src/renderer/src/App.vue'
import { createMockApi } from '../utils/mock-api'

const mockApi = createMockApi()

// Inject mock API and browser APIs into global window
Object.defineProperty(global, 'window', {
  value: {
    ...global.window,
    api: mockApi,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    matchMedia: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    })),
    getComputedStyle: vi.fn().mockReturnValue({
      getPropertyValue: vi.fn().mockReturnValue(''),
      overflow: 'auto',
      overflowY: 'auto',
      overflowX: 'auto'
    }),
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
      return setTimeout(() => callback(performance.now()), 0) as unknown as number
    }),
    cancelAnimationFrame: vi.fn((id: number) => clearTimeout(id)),
    localStorage: {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      length: 0,
      key: vi.fn().mockReturnValue(null)
    },
    navigator: {
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0'
    }
  },
  writable: true,
  configurable: true
})

// Also ensure navigator is available at global level
Object.defineProperty(global, 'navigator', {
  value: {
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0'
  },
  writable: true,
  configurable: true
})

const vuetify = createVuetify({ components, directives })

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', redirect: '/case' },
    { path: '/case', name: 'case', component: { template: '<div>Case</div>' } },
    { path: '/cohort', name: 'cohort', component: { template: '<div>Cohort</div>' } }
  ]
})

// Stubs for async (lazy-loaded) components — prevents defineAsyncComponent from
// firing dynamic imports that race with test environment teardown.
const asyncComponentStubs = {
  ImportStatusBar: { template: '<div />' },
  VariantDetailsPanel: { template: '<div />' },
  AppDialogHost: { template: '<div />' },
  KeyboardShortcutsDialog: { template: '<div />' },
  ViewTransitionOverlay: { template: '<div />' }
}

describe('App.vue', () => {
  it('mounts App without shell contract gaps', async () => {
    useShellNavigationSpy.mockReset()
    useShellLifecycleSpy.mockReset()
    useShellLifecycleSpy.mockReturnValue({
      handleDatabaseSwitched: vi.fn(),
      handleImportComplete: vi.fn(),
      handleBatchImportComplete: vi.fn()
    })

    router.push('/case')
    await router.isReady()

    const wrapper = mount(App, {
      global: {
        plugins: [vuetify, createPinia(), router],
        stubs: asyncComponentStubs
      }
    })

    expect(wrapper.findComponent({ name: 'AppToolbar' }).exists()).toBe(true)
    expect(wrapper.find('.v-navigation-drawer').exists()).toBe(true)
    expect(useShellNavigationSpy).toHaveBeenCalledTimes(1)
    expect(useShellLifecycleSpy).toHaveBeenCalledTimes(1)
    expect(useShellNavigationSpy.mock.calls[0]?.[0]).toHaveProperty('router')
    expect(useShellLifecycleSpy.mock.calls[0]?.[0]).toHaveProperty('currentDatabasePath')
    expect(useShellLifecycleSpy.mock.calls[0]?.[0]).toHaveProperty('api')
    expect(useShellLifecycleSpy.mock.calls[0]?.[0]).toHaveProperty('importStore')
  })

  async function mountWithDisplay(mobileBreakpoint: number) {
    useShellLifecycleSpy.mockReturnValue({
      handleDatabaseSwitched: vi.fn(),
      handleImportComplete: vi.fn(),
      handleBatchImportComplete: vi.fn()
    })
    router.push('/case')
    await router.isReady()
    // The suite replaces `window` with a plain object; give Vuetify's display
    // service a viewport so `mobile` (width < mobileBreakpoint) is meaningful.
    Object.assign(window, { innerWidth: 1350, innerHeight: 900 })
    const display = createVuetify({ components, directives, display: { mobileBreakpoint } })
    return mount(App, {
      global: { plugins: [display, createPinia(), router], stubs: asyncComponentStubs }
    })
  }

  it('keeps the docked desktop sidebar open when a case is opened (no layout shift)', async () => {
    const wrapper = await mountWithDisplay(0)
    wrapper.findComponent({ name: 'CaseList' }).vm.$emit('case-selected', 7, 'LB-1', 10, 0)
    await wrapper.vm.$nextTick()
    expect(wrapper.findComponent({ name: 'VNavigationDrawer' }).props('modelValue')).toBe(true)
  })

  it('dismisses the sidebar when it is a temporary overlay (mobile widths)', async () => {
    const wrapper = await mountWithDisplay(100_000)
    wrapper.findComponent({ name: 'CaseList' }).vm.$emit('case-selected', 7, 'LB-1', 10, 0)
    await wrapper.vm.$nextTick()
    expect(wrapper.findComponent({ name: 'VNavigationDrawer' }).props('modelValue')).toBe(false)
  })

  it('does not mount the details panel or shortcut dialog until first opened', async () => {
    const wrapper = await mountWithDisplay(0)
    expect(wrapper.findComponent({ name: 'VariantDetailsPanel' }).exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'KeyboardShortcutsDialog' }).exists()).toBe(false)
  })
})
