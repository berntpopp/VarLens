import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import App from '../../src/renderer/src/App.vue'

// Mock window.api for all components that need it
const mockApi = {
  cases: {
    list: vi.fn().mockResolvedValue([]),
    getAll: vi.fn().mockResolvedValue([]),
    delete: vi.fn()
  },
  import: {
    selectFile: vi.fn(),
    start: vi.fn(),
    onProgress: vi.fn(() => vi.fn()),
    cancel: vi.fn()
  },
  variants: {
    get: vi.fn().mockResolvedValue({ data: [], total: 0, filtered: 0 }),
    count: vi.fn().mockResolvedValue(0)
  },
  export: {
    toExcel: vi.fn()
  }
}

// Inject mock API and browser APIs into global window
global.window = {
  ...global.window,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api: mockApi as any,
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
  requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
    return setTimeout(() => callback(performance.now()), 0) as unknown as number
  }),
  cancelAnimationFrame: vi.fn((id: number) => clearTimeout(id))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

const vuetify = createVuetify({ components, directives })

describe('App.vue', () => {
  it('renders VarLens title', () => {
    const wrapper = mount(App, {
      global: {
        plugins: [vuetify]
      }
    })
    expect(wrapper.text()).toContain('VarLens')
  })

  it('uses Vuetify v-app component', () => {
    const wrapper = mount(App, {
      global: {
        plugins: [vuetify]
      }
    })
    expect(wrapper.find('.v-application').exists()).toBe(true)
  })
})
