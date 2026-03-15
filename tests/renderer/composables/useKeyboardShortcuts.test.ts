import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Module-level map that the mock factory can access
const keyHandlers = new Map<string, (e: KeyboardEvent) => void>()

vi.mock('@vueuse/core', () => ({
  onKeyStroke: (key: string | string[], handler: (e: KeyboardEvent) => void) => {
    const keys = Array.isArray(key) ? key : [key]
    for (const k of keys) {
      keyHandlers.set(k, handler)
    }
  }
}))

// Mock the isInputFocused import used by the composable
vi.mock('../../../src/renderer/src/composables/useTableKeyboardNav', () => ({
  isInputFocused: () => false
}))

describe('useKeyboardShortcuts', () => {
  beforeEach(() => {
    keyHandlers.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('registers Ctrl+Shift+X for clear all filters', async () => {
    const clearAll = vi.fn()
    const { useKeyboardShortcuts } =
      await import('../../../src/renderer/src/composables/useKeyboardShortcuts')
    useKeyboardShortcuts({ onClearAllFilters: clearAll })

    const handler = keyHandlers.get('X')
    expect(handler).toBeDefined()
  })

  it('does not register X handler when onClearAllFilters is not provided', async () => {
    const { useKeyboardShortcuts } =
      await import('../../../src/renderer/src/composables/useKeyboardShortcuts')
    useKeyboardShortcuts({})

    const handler = keyHandlers.get('X')
    expect(handler).toBeUndefined()
  })
})
