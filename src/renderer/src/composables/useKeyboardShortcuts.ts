import { onKeyStroke } from '@vueuse/core'
import { isInputFocused } from './useTableKeyboardNav'

interface KeyboardShortcutCallbacks {
  /** Alt+Shift+D (Option+Shift+D on macOS): Show disclaimer */
  onDisclaimer?: () => void
  /** Alt+Shift+Q (Option+Shift+Q on macOS): Show FAQ */
  onFaq?: () => void
  /** Alt+Shift+L (Option+Shift+L on macOS): Toggle log viewer */
  onLogViewer?: () => void
  onToggleFilterDrawer?: () => void
  /** Alt+Shift+C (Option+Shift+C on macOS): Toggle columns panel */
  onToggleColumnsDrawer?: () => void
  onSearchFocus?: () => void
  onHelp?: () => void
  /** Ctrl/Cmd+Shift+X: Clear all filters */
  onClearAllFilters?: () => void
  /**
   * Alt+Shift+O (Option+Shift+O on macOS): Import variant data. Not Alt+Shift+I,
   * which opens Chrome's "Report an issue" form on Windows/Linux.
   */
  onImport?: () => void
}

/**
 * Matcher for an Alt+Shift+<key> chord (Option+Shift on macOS), used for app
 * shortcuts that would otherwise clash with browser/Electron Ctrl/Cmd combos
 * (DevTools picker, quit, address bar, bookmark-all-tabs, page info).
 * Matches on `code`, not `key`: on macOS Option rewrites `key` (e.g. 'C' -> 'Ç').
 */
export function altShift(code: string): (e: KeyboardEvent) => boolean {
  return (e) => e.code === code && e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey
}

export const isColumnsShortcut = altShift('KeyC')

/**
 * Register an Alt+Shift chord. Skipped while typing so Option+Shift+<key> can
 * still insert its character on macOS; only prevents default when it fires.
 */
function onAltShift(code: string, callback: (() => void) | undefined): void {
  onKeyStroke(altShift(code), (e: KeyboardEvent) => {
    if (isInputFocused()) return
    e.preventDefault()
    callback?.()
  })
}

export function useKeyboardShortcuts(callbacks: KeyboardShortcutCallbacks): void {
  onAltShift('KeyD', callbacks.onDisclaimer)
  onAltShift('KeyQ', callbacks.onFaq)
  onAltShift('KeyL', callbacks.onLogViewer)
  onAltShift('KeyC', callbacks.onToggleColumnsDrawer)
  onAltShift('KeyO', callbacks.onImport)

  onKeyStroke('F', (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault()
      callbacks.onToggleFilterDrawer?.()
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
