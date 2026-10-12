import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SHORTCUTS, type ShortcutId } from '../../../src/renderer/src/config/keyboardShortcuts'

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

// Mock the isTextEntryFocused import used by the composable
vi.mock('../../../src/renderer/src/composables/useTableKeyboardNav', () => ({
  isTextEntryFocused: () => inputFocused.value
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

  describe('Alt+Shift app shortcuts (browser-safe)', () => {
    type CallbackName = 'onFaq' | 'onLogViewer' | 'onDisclaimer' | 'onImport'
    const cases: Array<{
      name: CallbackName
      code: string
      upper: string
      macKey: string
      old: KeyboardEventInit[]
    }> = [
      {
        name: 'onFaq',
        code: 'KeyQ',
        upper: 'Q',
        macKey: 'Œ',
        old: [
          { key: 'Q', code: 'KeyQ', ctrlKey: true, shiftKey: true },
          { key: 'Q', code: 'KeyQ', metaKey: true, shiftKey: true }
        ]
      },
      {
        name: 'onLogViewer',
        code: 'KeyL',
        upper: 'L',
        macKey: 'Ò',
        old: [
          { key: 'l', code: 'KeyL', ctrlKey: true },
          { key: 'l', code: 'KeyL', metaKey: true }
        ]
      },
      {
        name: 'onDisclaimer',
        code: 'KeyD',
        upper: 'D',
        macKey: 'Î',
        old: [
          { key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true },
          { key: 'D', code: 'KeyD', metaKey: true, shiftKey: true }
        ]
      },
      {
        name: 'onImport',
        code: 'KeyO',
        upper: 'O',
        macKey: 'Ø',
        old: [
          { key: 'i', code: 'KeyI', ctrlKey: true },
          { key: 'i', code: 'KeyI', metaKey: true },
          // Alt+Shift+I is Chrome's "Report an issue" form; leave it to the browser.
          { key: 'I', code: 'KeyI', altKey: true, shiftKey: true }
        ]
      }
    ]

    async function setup(): Promise<Record<CallbackName, ReturnType<typeof vi.fn>>> {
      const spies = {
        onFaq: vi.fn(),
        onLogViewer: vi.fn(),
        onDisclaimer: vi.fn(),
        onImport: vi.fn()
      }
      const { useKeyboardShortcuts } =
        await import('../../../src/renderer/src/composables/useKeyboardShortcuts')
      useKeyboardShortcuts(spies)
      return spies
    }

    for (const c of cases) {
      describe(c.name, () => {
        it(`fires on Alt+Shift+${c.upper} and prevents default`, async () => {
          const spies = await setup()
          const event = dispatch({ key: c.upper, code: c.code, altKey: true, shiftKey: true })
          expect(spies[c.name]).toHaveBeenCalledTimes(1)
          expect(event.defaultPrevented).toBe(true)
          for (const other of cases) {
            if (other.name !== c.name) expect(spies[other.name]).not.toHaveBeenCalled()
          }
        })

        it('fires on macOS Option+Shift where key is rewritten', async () => {
          const spies = await setup()
          dispatch({ key: c.macKey, code: c.code, altKey: true, shiftKey: true })
          expect(spies[c.name]).toHaveBeenCalledTimes(1)
        })

        it('no longer captures the old browser-reserved Ctrl/Cmd combo', async () => {
          const spies = await setup()
          for (const init of c.old) {
            const event = dispatch(init)
            expect(event.defaultPrevented).toBe(false)
          }
          expect(spies[c.name]).not.toHaveBeenCalled()
        })

        it('does not fire with extra Ctrl/Cmd or without Shift', async () => {
          const spies = await setup()
          dispatch({ key: c.upper, code: c.code, altKey: true, shiftKey: true, ctrlKey: true })
          dispatch({ key: c.upper, code: c.code, altKey: true, shiftKey: true, metaKey: true })
          dispatch({ key: c.upper.toLowerCase(), code: c.code, altKey: true })
          expect(spies[c.name]).not.toHaveBeenCalled()
        })

        it('is skipped while a text input is focused', async () => {
          const spies = await setup()
          inputFocused.value = true
          const event = dispatch({ key: c.macKey, code: c.code, altKey: true, shiftKey: true })
          expect(spies[c.name]).not.toHaveBeenCalled()
          expect(event.defaultPrevented).toBe(false)
        })
      })
    }
  })

  it('keeps Ctrl/Cmd+Shift+F and Ctrl/Cmd+Shift+X unchanged', async () => {
    const onToggleFilterDrawer = vi.fn()
    const onClearAllFilters = vi.fn()
    const { useKeyboardShortcuts } =
      await import('../../../src/renderer/src/composables/useKeyboardShortcuts')
    useKeyboardShortcuts({ onToggleFilterDrawer, onClearAllFilters })
    expect(dispatch({ key: 'F', ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true)
    dispatch({ key: 'F', metaKey: true, shiftKey: true })
    expect(dispatch({ key: 'X', ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true)
    expect(onToggleFilterDrawer).toHaveBeenCalledTimes(2)
    expect(onClearAllFilters).toHaveBeenCalledTimes(1)
  })
})

/**
 * The shared shortcut list (config/keyboardShortcuts.ts) must match real
 * bindings. App-wide chords are fired here from their listed key text; row
 * keys are bound by reference to SHORTCUTS in the table components.
 */
describe('every shared shortcut has a binding', () => {
  type Callbacks = Parameters<
    typeof import('../../../src/renderer/src/composables/useKeyboardShortcuts').useKeyboardShortcuts
  >[0]

  /** Build the keydown a user produces for a listed key such as "Alt+Shift+C". */
  function eventFor(keyText: string): KeyboardEventInit {
    const parts = keyText.split('+')
    const last = parts.pop()!
    const shiftKey = parts.includes('Shift')
    const letter = /^[a-z]$/i.test(last)
    return {
      key: letter && shiftKey ? last.toUpperCase() : last,
      code: letter ? `Key${last.toUpperCase()}` : undefined,
      shiftKey,
      ctrlKey: parts.includes('Ctrl'),
      metaKey: parts.includes('Cmd'),
      altKey: parts.includes('Alt') || parts.includes('Option')
    }
  }

  const APP_WIDE: Partial<Record<ShortcutId, keyof Callbacks>> = {
    search: 'onSearchFocus',
    toggleFilters: 'onToggleFilterDrawer',
    toggleColumns: 'onToggleColumnsDrawer',
    clearFilters: 'onClearAllFilters',
    help: 'onHelp',
    import: 'onImport',
    logViewer: 'onLogViewer',
    disclaimer: 'onDisclaimer',
    faq: 'onFaq'
  }
  /** Where the remaining shortcuts are bound (typed: a new shortcut must be placed). */
  const BOUND_ELSEWHERE: Record<Exclude<ShortcutId, keyof typeof APP_WIDE>, string> = {
    moveSelection: 'VariantTable / CohortDataTable ArrowUp/ArrowDown (interactive-prop.test.ts)',
    openDetails: 'VariantTable / CohortDataTable via SHORTCUTS.openDetails.key',
    closeDetails: 'VariantTable / CohortDataTable via SHORTCUTS.closeDetails.key',
    star: 'VariantTable / CohortDataTable via SHORTCUTS.star.key',
    comment: 'VariantTable / CohortDataTable via SHORTCUTS.comment.key',
    acmg: 'VariantTable / CohortDataTable via SHORTCUTS.acmg.key',
    expandRow: 'CohortDataTable via SHORTCUTS.expandRow.key',
    proteinView: 'VariantTable / CohortDataTable / ShortlistTable via useProteinViewShortcut',
    closeDrawer: 'Vuetify overlay/drawer Escape (utils/overlay-escape-guard.ts)'
  }

  beforeEach(() => {
    keyHandlers.clear()
    predicateHandlers.length = 0
    inputFocused.value = false
  })

  it('lists every shortcut exactly once', () => {
    const covered = [...Object.keys(APP_WIDE), ...Object.keys(BOUND_ELSEWHERE)].sort()
    expect(covered).toEqual(Object.keys(SHORTCUTS).sort())
  })

  it.each(Object.entries(APP_WIDE))('%s fires from its listed key text', async (id, callback) => {
    const spy = vi.fn()
    const { useKeyboardShortcuts } =
      await import('../../../src/renderer/src/composables/useKeyboardShortcuts')
    useKeyboardShortcuts({ [callback!]: spy })
    dispatch(eventFor(SHORTCUTS[id as ShortcutId].key))
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
