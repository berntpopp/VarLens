import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import App from '../../src/renderer/src/App.vue'

// Mock window.api for all components that need it
// This must match the API structure in src/preload/index.ts
const mockApi = {
  cases: {
    list: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined)
  },
  variants: {
    query: vi.fn().mockResolvedValue({ data: [], total_count: 0 }),
    getFilterOptions: vi.fn().mockResolvedValue({ consequences: [], genes: [] }),
    search: vi.fn().mockResolvedValue([])
  },
  import: {
    selectFile: vi.fn().mockResolvedValue(null),
    start: vi.fn().mockResolvedValue({ success: true }),
    onProgress: vi.fn(() => vi.fn()), // Returns cleanup function
    cancel: vi.fn().mockResolvedValue(undefined)
  },
  batchImport: {
    selectFiles: vi.fn().mockResolvedValue([]),
    selectFolder: vi.fn().mockResolvedValue([]),
    checkDuplicates: vi.fn().mockResolvedValue({ duplicates: [], newFiles: [] }),
    start: vi.fn().mockResolvedValue({ success: true, imported: 0, failed: 0 }),
    cancel: vi.fn().mockResolvedValue(undefined),
    selectZip: vi.fn().mockResolvedValue(null),
    testZipPassword: vi.fn().mockResolvedValue({ valid: false }),
    extractZip: vi.fn().mockResolvedValue({ success: false }),
    cleanupZipTemp: vi.fn().mockResolvedValue(undefined),
    onProgress: vi.fn(() => vi.fn()), // Returns cleanup function
    onComplete: vi.fn(() => vi.fn()) // Returns cleanup function
  },
  system: {
    getVersion: vi.fn().mockResolvedValue({ app: '0.2.0', electron: '33.0.0' }),
    getUserDataPath: vi.fn().mockResolvedValue('/mock/user/data')
  },
  export: {
    variants: vi.fn().mockResolvedValue({ success: true })
  },
  shell: {
    openExternal: vi.fn().mockResolvedValue({ success: true }),
    updateDomains: vi.fn().mockResolvedValue(undefined)
  },
  database: {
    selectFile: vi.fn().mockResolvedValue(null),
    selectSaveLocation: vi.fn().mockResolvedValue(null),
    open: vi.fn().mockResolvedValue({ success: false }),
    create: vi.fn().mockResolvedValue({ success: false }),
    rekey: vi.fn().mockResolvedValue({ success: false }),
    info: vi.fn().mockResolvedValue(null),
    recentList: vi.fn().mockResolvedValue([])
  },
  cohort: {
    getVariants: vi.fn().mockResolvedValue({ data: [], total_count: 0 }),
    getSummary: vi.fn().mockResolvedValue({ totalCases: 0, totalVariants: 0 }),
    getCarriers: vi.fn().mockResolvedValue([]),
    getGeneBurden: vi.fn().mockResolvedValue([]),
    listCohorts: vi.fn().mockResolvedValue([])
  },
  annotations: {
    getGlobal: vi.fn().mockResolvedValue(null),
    upsertGlobal: vi.fn().mockResolvedValue({}),
    deleteGlobal: vi.fn().mockResolvedValue(undefined),
    getPerCase: vi.fn().mockResolvedValue(null),
    upsertPerCase: vi.fn().mockResolvedValue({}),
    deletePerCase: vi.fn().mockResolvedValue(undefined),
    getForVariant: vi.fn().mockResolvedValue({ global: null, perCase: null })
  },
  logs: {
    onMessage: vi.fn(() => vi.fn()) // Returns cleanup function
  },
  updater: {
    checkForUpdate: vi.fn().mockResolvedValue(undefined),
    downloadUpdate: vi.fn().mockResolvedValue(undefined),
    installUpdate: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockResolvedValue({ state: 'idle' }),
    onStatusChange: vi.fn(() => vi.fn()) // Returns cleanup function
  }
}

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
  it('renders VarLens title', async () => {
    router.push('/')
    await router.isReady()
    const wrapper = mount(App, {
      global: {
        plugins: [vuetify, createPinia(), router],
        stubs: asyncComponentStubs
      }
    })
    expect(wrapper.text()).toContain('VarLens')
  })

  it('uses Vuetify v-app component', async () => {
    router.push('/')
    await router.isReady()
    const wrapper = mount(App, {
      global: {
        plugins: [vuetify, createPinia(), router],
        stubs: asyncComponentStubs
      }
    })
    expect(wrapper.find('.v-application').exists()).toBe(true)
  })
})
