// Test setup file for Vitest
// Mocks browser APIs required by Vuetify components

import { vi } from 'vitest'

// Mock visualViewport (required by VOverlay/VDialog)
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'visualViewport', {
    value: {
      width: 1024,
      height: 768,
      scale: 1,
      offsetLeft: 0,
      offsetTop: 0,
      pageLeft: 0,
      pageTop: 0,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    },
    writable: true,
    configurable: true
  })

  // Mock matchMedia (required by Vuetify)
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }),
    writable: true,
    configurable: true
  })

  // Mock IntersectionObserver (required by Vuetify)
  global.IntersectionObserver = class IntersectionObserver {
    constructor() {}
    disconnect() {}
    observe() {}
    takeRecords() {
      return []
    }
    unobserve() {}
  } as unknown as typeof global.IntersectionObserver

  // Mock ResizeObserver (required by Vuetify)
  global.ResizeObserver = class ResizeObserver {
    constructor() {}
    disconnect() {}
    observe() {}
    unobserve() {}
  } as unknown as typeof global.ResizeObserver
}
