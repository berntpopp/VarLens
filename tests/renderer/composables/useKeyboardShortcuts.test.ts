import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Module-level map that the mock factory can access
const keyHandlers = new Map<string, (e: KeyboardEvent) => void>()
type KeyPredicate = (e: KeyboardEvent) => boolean
const predicateHandlers: Array<{ filter: KeyPredicate; handler: (e: KeyboardEvent) => void }> = []
const inputFocused = { value: false }

vi.mock('@vueuse/core', () => ({
  onKeyStroke: (key: string | string[] | KeyPredicate, handler: (e: KeyboardEvent) => void) => {
    if (typeof key === 'function') {
      predicateHandlers.push({ filter: key, handler })
      return
    }
    const keys = Array.isArray(key) ? key : [key]
    for (const k of keys) {
      keyHandlers.set(k, handler)
    }
  }
}))

// Mock the isInputFocused import used by the composable
vi.mock('../../../src/renderer/src/composables/useTableKeyboardNav', () => ({
  isInputFocused: () => inputFocused.value
}))

/** Mimic VueUse's dispatch: string filters match e.key, predicates get the event. */
function dispatch(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { cancelable: true, ...init })
  keyHandlers.get(event.key)?.(event)
  for (const { filter, handler } of predicateHandlers) {
    if (filter(event)) handler(event)
  }
  return event
}

describe('useKeyboardShortcuts', () => {
  beforeEach(() => {
    keyHandlers.clear()
    predicateHandlers.length = 0
    inputFocused.value = false
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

  describe('columns panel shortcut', () => {
    async function setup(): Promise<ReturnType<typeof vi.fn>> {
      const toggleColumns = vi.fn()
      const { useKeyboardShortcuts } =
        await import('../../../src/renderer/src/composables/useKeyboardShortcuts')
      useKeyboardShortcuts({ onToggleColumnsDrawer: toggleColumns })
      return toggleColumns
    }

    it('fires on Alt+Shift+C matched by code KeyC', async () => {
      const toggleColumns = await setup()
      const event = dispatch({ key: 'C', code: 'KeyC', altKey: true, shiftKey: true })
      expect(toggleColumns).toHaveBeenCalledTimes(1)
      expect(event.defaultPrevented).toBe(true)
    })

    it('fires on macOS Option+Shift+C where key is rewritten to a special char', async () => {
      const toggleColumns = await setup()
      dispatch({ key: '\u00C7', code: 'KeyC', altKey: true, shiftKey: true })
      expect(toggleColumns).toHaveBeenCalledTimes(1)
    })

    it('does not capture Ctrl+Shift+C or Cmd+Shift+C (DevTools element picker)', async () => {
      const toggleColumns = await setup()
      const ctrl = dispatch({ key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true })
      const meta = dispatch({ key: 'C', code: 'KeyC', metaKey: true, shiftKey: true })
      expect(toggleColumns).not.toHaveBeenCalled()
      expect(ctrl.defaultPrevented).toBe(false)
      expect(meta.defaultPrevented).toBe(false)
    })

    it('does not fire when extra modifiers are held or Shift is missing', async () => {
      const toggleColumns = await setup()
      dispatch({ key: 'C', code: 'KeyC', altKey: true, shiftKey: true, ctrlKey: true })
      dispatch({ key: 'c', code: 'KeyC', altKey: true })
      expect(toggleColumns).not.toHaveBeenCalled()
    })

    it('is skipped while a text input is focused', async () => {
      const toggleColumns = await setup()
      inputFocused.value = true
      const event = dispatch({ key: 'C', code: 'KeyC', altKey: true, shiftKey: true })
      expect(toggleColumns).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(false)
    })
  })
})
