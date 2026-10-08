import { afterEach, describe, it, expect, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
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
import { AppStateKey } from '../../src/renderer/src/composables/useAppState'
import type { AppStateReturn } from '../../src/renderer/src/composables/useAppState'
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
  // The apps share one router: a mounted leftover would answer the next test's URL changes.
  enableAutoUnmount(afterEach)

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

  async function mountWithDisplay(innerWidth: number) {
    useShellLifecycleSpy.mockReturnValue({
      handleDatabaseSwitched: vi.fn(),
      handleImportComplete: vi.fn(),
      handleBatchImportComplete: vi.fn()
    })
    router.push('/case')
    await router.isReady()
    // The suite replaces `window` with a plain object; give Vuetify's display
    // service a viewport so the sidebar's md (840 px) overlay breakpoint applies.
    Object.assign(window, { innerWidth, innerHeight: 900 })
    const display = createVuetify({ components, directives })
    return mount(App, {
      global: { plugins: [display, createPinia(), router], stubs: asyncComponentStubs }
    })
  }

  it('keeps the docked desktop sidebar open when a case is opened (no layout shift)', async () => {
    // 1024 px workstations keep the docked sidebar (breakpoint is md, not lg/1145)
    const wrapper = await mountWithDisplay(1024)
    wrapper.findComponent({ name: 'CaseList' }).vm.$emit('case-selected', 7, 'LB-1', 10, 0)
    await wrapper.vm.$nextTick()
    expect(wrapper.findComponent({ name: 'VNavigationDrawer' }).props('modelValue')).toBe(true)
  })

  it('dismisses the sidebar when it is a temporary overlay (mobile widths)', async () => {
    const wrapper = await mountWithDisplay(800)
    wrapper.findComponent({ name: 'CaseList' }).vm.$emit('case-selected', 7, 'LB-1', 10, 0)
    await wrapper.vm.$nextTick()
    expect(wrapper.findComponent({ name: 'VNavigationDrawer' }).props('modelValue')).toBe(false)
  })

  describe('with an unsaved ACMG draft open', () => {
    const listSelectCase = vi.fn()
    // What the metadata editor would open: it reads the selected case when asked.
    const editorOpenedFor: (number | null)[] = []
    let state: AppStateReturn

    async function mountWithDraft(answer: Promise<boolean>) {
      listSelectCase.mockClear()
      editorOpenedFor.length = 0
      useShellLifecycleSpy.mockReturnValue({})
      await router.push('/case')
      const wrapper = mount(App, {
        global: {
          plugins: [vuetify, createPinia(), router],
          stubs: {
            ...asyncComponentStubs,
            CaseList: {
              name: 'CaseList',
              template: '<div />',
              setup: (_: unknown, { expose }: { expose: (exposed: object) => void }) =>
                expose({ selectCase: listSelectCase, refreshCases: vi.fn() })
            },
            AppDialogHost: {
              template: '<div />',
              setup: (_: unknown, { expose }: { expose: (exposed: object) => void }) =>
                expose({
                  showCaseMetadata: () => editorOpenedFor.push(state.selectedCaseId.value)
                })
            }
          }
        }
      })
      await flushPromises() // the URL restore of the mount, which clears the case
      state = (wrapper.vm.$ as unknown as { provides: Record<symbol, AppStateReturn> }).provides[
        AppStateKey as symbol
      ]
      state.selectCase({ caseId: 1, caseName: 'A' })
      state.selectedPanelVariant.value = { id: 1 } as never
      state.panelOpen.value = true
      // Once answered the draft is gone (applied / discarded) or kept (asked again).
      const guard = vi.fn<() => Promise<boolean> | null>(() => null).mockReturnValueOnce(answer)
      state.setPanelLeaveGuard(guard)
      return { caseList: wrapper.findComponent({ name: 'CaseList' }), guard }
    }

    it('"Edit case" opens the editor for the new case, after the prompt', async () => {
      let answer!: (leave: boolean) => void
      const { caseList } = await mountWithDraft(new Promise<boolean>((r) => (answer = r)))

      caseList.vm.$emit('edit-case', 2, 'B', 0, 0)
      await flushPromises()
      expect(editorOpenedFor).toEqual([])

      answer(true)
      await flushPromises()
      expect(editorOpenedFor).toEqual([2])
    })

    it('"Edit case" does nothing when the prompt is cancelled', async () => {
      const { caseList } = await mountWithDraft(Promise.resolve(false))
      caseList.vm.$emit('edit-case', 2, 'B', 0, 0)
      await flushPromises()
      expect(editorOpenedFor).toEqual([])
      expect(state.selectedCaseId.value).toBe(1)
    })

    it('deleting the open case clears it without asking', async () => {
      const { caseList, guard } = await mountWithDraft(new Promise<boolean>(() => {}))
      caseList.vm.$emit('case-deleted', 1)
      expect(guard).not.toHaveBeenCalled()
      expect(state.selectedCaseId.value).toBeNull()
      expect(state.panelOpen.value).toBe(false)
    })

    it('Cancel puts the sidebar highlight back on the open case', async () => {
      const { caseList, guard } = await mountWithDraft(Promise.resolve(false))
      caseList.vm.$emit('case-selected', 2, 'B', 0, 0)
      await flushPromises()
      expect(state.selectedCaseId.value).toBe(1)
      expect(listSelectCase).toHaveBeenCalledExactlyOnceWith(1)

      // The list reports its restored highlight: that must not ask again.
      caseList.vm.$emit('case-selected', 1, 'A', 0, 0)
      await flushPromises()
      expect(guard).toHaveBeenCalledTimes(1)
    })
  })

  it('does not mount the details panel or shortcut dialog until first opened', async () => {
    const wrapper = await mountWithDisplay(1350)
    expect(wrapper.findComponent({ name: 'VariantDetailsPanel' }).exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'KeyboardShortcutsDialog' }).exists()).toBe(false)
  })
})
