import { onKeyStroke } from '@vueuse/core'
import { isInputFocused } from './useTableKeyboardNav'

interface KeyboardShortcutCallbacks {
  onDisclaimer?: () => void
  onFaq?: () => void
  onLogViewer?: () => void
  onToggleFilterDrawer?: () => void
  onToggleColumnsDrawer?: () => void
  onSearchFocus?: () => void
  onHelp?: () => void
  /** Ctrl+Shift+X: Clear all filters */
  onClearAllFilters?: () => void
}

export function useKeyboardShortcuts(callbacks: KeyboardShortcutCallbacks): void {
  onKeyStroke('D', (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault()
      callbacks.onDisclaimer?.()
    }
  })

  onKeyStroke('Q', (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault()
      callbacks.onFaq?.()
    }
  })

  onKeyStroke('l', (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
      e.preventDefault()
      callbacks.onLogViewer?.()
    }
  })

  onKeyStroke('F', (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault()
      callbacks.onToggleFilterDrawer?.()
    }
  })

  onKeyStroke('C', (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault()
      callbacks.onToggleColumnsDrawer?.()
    }
  })

  onKeyStroke('/', (e: KeyboardEvent) => {
    if (isInputFocused()) return
    e.preventDefault()
    callbacks.onSearchFocus?.()
  })

  onKeyStroke('?', (e: KeyboardEvent) => {
    if (isInputFocused()) return
    e.preventDefault()
    callbacks.onHelp?.()
  })

  // Clear all filters: Ctrl/Cmd+Shift+X
  if (callbacks.onClearAllFilters) {
    onKeyStroke('X', (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault()
        callbacks.onClearAllFilters!()
      }
    })
  }
}
