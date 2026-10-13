import { describe, it, expect, afterEach, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { withSetup } from '../../utils/test-helpers'
import {
  isControlFocused,
  isInputFocused,
  isOverlayOpen,
  isTextEntryFocused,
  useTableKeyboardNav
} from '@renderer/composables/useTableKeyboardNav'

describe('useTableKeyboardNav', () => {
  let app: { unmount: () => void }

  afterEach(() => {
    if (app) app.unmount()
  })

  describe('Initial state', () => {
    it('selectedIndex starts as null', () => {
      const items = ref([{ id: 1 }, { id: 2 }])
      const [result, appInstance] = withSetup(() =>
        useTableKeyboardNav({
          items,
          getItemId: (item: { id: number }) => item.id,
          onSelect: vi.fn()
        })
      )
      app = appInstance

      expect(result.selectedIndex.value).toBe(null)
    })

    it('selectedItem is null when no selection', () => {
      const items = ref([{ id: 1 }, { id: 2 }])
      const [result, appInstance] = withSetup(() =>
        useTableKeyboardNav({
          items,
          getItemId: (item: { id: number }) => item.id,
          onSelect: vi.fn()
        })
      )
      app = appInstance

      expect(result.selectedItem.value).toBe(null)
    })
  })

  describe('selectIndex', () => {
    it('sets selectedIndex and calls onSelect', () => {
      const items = ref([{ id: 1 }, { id: 2 }, { id: 3 }])
      const onSelect = vi.fn()
      const [result, appInstance] = withSetup(() =>
        useTableKeyboardNav({
          items,
          getItemId: (item: { id: number }) => item.id,
          onSelect
        })
      )
      app = appInstance

      result.selectIndex(1)
      expect(result.selectedIndex.value).toBe(1)
      expect(result.selectedItem.value).toEqual({ id: 2 })
      expect(onSelect).toHaveBeenCalledWith({ id: 2 })
    })

    it('clamps to 0 when negative', () => {
      const items = ref([{ id: 1 }, { id: 2 }])
      const [result, appInstance] = withSetup(() =>
        useTableKeyboardNav({
          items,
          getItemId: (item: { id: number }) => item.id,
          onSelect: vi.fn()
        })
      )
      app = appInstance

      result.selectIndex(-5)
      expect(result.selectedIndex.value).toBe(0)
    })

    it('clamps to last index when exceeding items length', () => {
      const items = ref([{ id: 1 }, { id: 2 }])
      const [result, appInstance] = withSetup(() =>
        useTableKeyboardNav({
          items,
          getItemId: (item: { id: number }) => item.id,
          onSelect: vi.fn()
        })
      )
      app = appInstance

      result.selectIndex(99)
      expect(result.selectedIndex.value).toBe(1)
    })

    it('does nothing when items are empty', () => {
      const items = ref<{ id: number }[]>([])
      const onSelect = vi.fn()
      const [result, appInstance] = withSetup(() =>
        useTableKeyboardNav({
          items,
          getItemId: (item: { id: number }) => item.id,
          onSelect
        })
      )
      app = appInstance

      result.selectIndex(0)
      expect(result.selectedIndex.value).toBe(null)
      expect(onSelect).not.toHaveBeenCalled()
    })
  })

  describe('selectByClick', () => {
    it('finds index from item and sets selectedIndex', () => {
      const items = ref([{ id: 10 }, { id: 20 }, { id: 30 }])
      const onSelect = vi.fn()
      const [result, appInstance] = withSetup(() =>
        useTableKeyboardNav({
          items,
          getItemId: (item: { id: number }) => item.id,
          onSelect
        })
      )
      app = appInstance

      result.selectByClick({ id: 20 })
      expect(result.selectedIndex.value).toBe(1)
      expect(onSelect).toHaveBeenCalledWith({ id: 20 })
    })
  })

  describe('moveUp / moveDown', () => {
    it('moveDown from null selects first row', () => {
      const items = ref([{ id: 1 }, { id: 2 }])
      const [result, appInstance] = withSetup(() =>
        useTableKeyboardNav({
          items,
          getItemId: (item: { id: number }) => item.id,
          onSelect: vi.fn()
        })
      )
      app = appInstance

      result.moveDown()
      expect(result.selectedIndex.value).toBe(0)
    })

    it('moveDown increments selectedIndex', () => {
      const items = ref([{ id: 1 }, { id: 2 }, { id: 3 }])
      const [result, appInstance] = withSetup(() =>
        useTableKeyboardNav({
          items,
          getItemId: (item: { id: number }) => item.id,
          onSelect: vi.fn()
        })
      )
      app = appInstance

      result.selectIndex(0)
      result.moveDown()
      expect(result.selectedIndex.value).toBe(1)
    })

    it('moveDown at last index stays at last index', () => {
      const items = ref([{ id: 1 }, { id: 2 }])
      const [result, appInstance] = withSetup(() =>
        useTableKeyboardNav({
          items,
          getItemId: (item: { id: number }) => item.id,
          onSelect: vi.fn()
        })
      )
      app = appInstance

      result.selectIndex(1)
      result.moveDown()
      expect(result.selectedIndex.value).toBe(1)
    })

    it('moveUp from null selects last row', () => {
      const items = ref([{ id: 1 }, { id: 2 }, { id: 3 }])
      const [result, appInstance] = withSetup(() =>
        useTableKeyboardNav({
          items,
          getItemId: (item: { id: number }) => item.id,
          onSelect: vi.fn()
        })
      )
      app = appInstance

      result.moveUp()
      expect(result.selectedIndex.value).toBe(2)
    })

    it('moveUp decrements selectedIndex', () => {
      const items = ref([{ id: 1 }, { id: 2 }, { id: 3 }])
      const [result, appInstance] = withSetup(() =>
        useTableKeyboardNav({
          items,
          getItemId: (item: { id: number }) => item.id,
          onSelect: vi.fn()
        })
      )
      app = appInstance

      result.selectIndex(2)
      result.moveUp()
      expect(result.selectedIndex.value).toBe(1)
    })

    it('moveUp at index 0 stays at 0', () => {
      const items = ref([{ id: 1 }, { id: 2 }])
      const [result, appInstance] = withSetup(() =>
        useTableKeyboardNav({
          items,
          getItemId: (item: { id: number }) => item.id,
          onSelect: vi.fn()
        })
      )
      app = appInstance

      result.selectIndex(0)
      result.moveUp()
      expect(result.selectedIndex.value).toBe(0)
    })
  })

  describe('clearSelection', () => {
    it('resets selectedIndex to null', () => {
      const items = ref([{ id: 1 }, { id: 2 }])
      const [result, appInstance] = withSetup(() =>
        useTableKeyboardNav({
          items,
          getItemId: (item: { id: number }) => item.id,
          onSelect: vi.fn()
        })
      )
      app = appInstance

      result.selectIndex(1)
      result.clearSelection()
      expect(result.selectedIndex.value).toBe(null)
      expect(result.selectedItem.value).toBe(null)
    })
  })

  describe('items reactivity', () => {
    it('resets selection when items change', async () => {
      const items = ref([{ id: 1 }, { id: 2 }])
      const [result, appInstance] = withSetup(() =>
        useTableKeyboardNav({
          items,
          getItemId: (item: { id: number }) => item.id,
          onSelect: vi.fn()
        })
      )
      app = appInstance

      result.selectIndex(1)
      expect(result.selectedIndex.value).toBe(1)

      // Replace items (new page loaded)
      items.value = [{ id: 3 }, { id: 4 }]
      await nextTick()
      expect(result.selectedIndex.value).toBe(null)
    })
  })

  describe('isInputFocused guard', () => {
    it('returns true when input element is focused', () => {
      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus()

      const items = ref([{ id: 1 }])
      const [result, appInstance] = withSetup(() =>
        useTableKeyboardNav({
          items,
          getItemId: (item: { id: number }) => item.id,
          onSelect: vi.fn()
        })
      )
      app = appInstance

      expect(result.isInputFocused()).toBe(true)
      document.body.removeChild(input)
    })

    it('returns true when textarea is focused', () => {
      const textarea = document.createElement('textarea')
      document.body.appendChild(textarea)
      textarea.focus()

      const items = ref([{ id: 1 }])
      const [result, appInstance] = withSetup(() =>
        useTableKeyboardNav({
          items,
          getItemId: (item: { id: number }) => item.id,
          onSelect: vi.fn()
        })
      )
      app = appInstance

      expect(result.isInputFocused()).toBe(true)
      document.body.removeChild(textarea)
    })

    it('returns false when no input is focused', () => {
      const items = ref([{ id: 1 }])
      const [result, appInstance] = withSetup(() =>
        useTableKeyboardNav({
          items,
          getItemId: (item: { id: number }) => item.id,
          onSelect: vi.fn()
        })
      )
      app = appInstance

      expect(result.isInputFocused()).toBe(false)
    })

    it('returns true when contenteditable element is focused', () => {
      const div = document.createElement('div')
      div.setAttribute('contenteditable', 'true')
      document.body.appendChild(div)
      div.focus()

      const items = ref([{ id: 1 }])
      const [result, appInstance] = withSetup(() =>
        useTableKeyboardNav({
          items,
          getItemId: (item: { id: number }) => item.id,
          onSelect: vi.fn()
        })
      )
      app = appInstance

      expect(result.isInputFocused()).toBe(true)
      document.body.removeChild(div)
    })

    it('treats a focused link as owning row keys but not as text entry', () => {
      const link = document.createElement('a')
      link.href = 'https://example.org'
      document.body.appendChild(link)
      link.focus()

      // Row shortcuts (Enter opens the panel) must yield to the link...
      expect(isInputFocused()).toBe(true)
      // ...while global app shortcuts (Alt+Shift+*, '/', '?') keep working.
      expect(isTextEntryFocused()).toBe(false)
      document.body.removeChild(link)
    })

    it('returns true while a dialog is open, whatever has focus', () => {
      document.body.innerHTML = '' // inputs the tests above left focused
      const dialog = document.createElement('div')
      dialog.className = 'v-overlay v-overlay--active v-dialog'
      document.body.appendChild(dialog)
      expect(isInputFocused()).toBe(true)
      dialog.remove()
      expect(isInputFocused()).toBe(false)
    })
  })
})

describe('isOverlayOpen', () => {
  afterEach(() => document.body.replaceChildren())

  it.each([
    ['an open dialog', 'v-dialog v-overlay--active', true],
    ['an open menu', 'v-menu v-overlay--active', true],
    ['a modal drawer (scrim)', 'v-navigation-drawer__scrim', true],
    ['a non-modal panel', 'v-navigation-drawer v-navigation-drawer--active', false]
  ])('%s → %s', (_label, className, expected) => {
    const el = document.createElement('div')
    el.className = className
    document.body.appendChild(el)
    expect(isOverlayOpen()).toBe(expected)
  })
})

describe('isControlFocused', () => {
  afterEach(() => document.body.replaceChildren())

  it.each([
    ['a button', '<button>Lollipop</button>', true],
    ['an element inside a button', '<button><span tabindex="-1">x</span></button>', true],
    ['a role=button element', '<div role="button" tabindex="0">x</div>', true],
    ['a link', '<a href="https://example.org">x</a>', true],
    ['a table cell', '<table><tr><td tabindex="0">x</td></tr></table>', false]
  ])('%s → %s (Enter activates it, not the row panel)', (_label, html, expected) => {
    document.body.innerHTML = html
    const focusable = document.body.querySelectorAll<HTMLElement>('[tabindex], button, a')
    focusable[focusable.length - 1].focus() // the innermost one
    expect(isControlFocused()).toBe(expected)
  })

  it('is false with nothing focused', () => {
    expect(isControlFocused()).toBe(false)
  })
})

describe('arrow navigation and a focused control', () => {
  afterEach(() => document.body.replaceChildren())

  it.each(['moveDown', 'moveUp'] as const)(
    '%s releases a focused button so Enter opens the row again',
    (move) => {
      document.body.innerHTML = '<button>star</button>'
      const button = document.querySelector('button')!
      // focus left behind by a mouse click
      button.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      button.focus()
      const [nav, app] = withSetup(() =>
        useTableKeyboardNav({ items: ref([{ id: 1 }]), getItemId: (i) => i.id, onSelect: vi.fn() })
      )
      nav[move]()
      expect(isControlFocused()).toBe(false)
      expect(nav.selectedIndex.value).toBe(0)
      app.unmount()
    }
  )

  it('keeps focus reached by keyboard so Tab users keep their place', () => {
    document.body.innerHTML = '<button>copy</button>'
    const button = document.querySelector('button')!
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    button.focus() // reached by Tab: the last pointer press was elsewhere
    const [nav, app] = withSetup(() =>
      useTableKeyboardNav({ items: ref([{ id: 1 }]), getItemId: (i) => i.id, onSelect: vi.fn() })
    )
    nav.moveDown()
    expect(document.activeElement).toBe(button)
    app.unmount()
  })
})
