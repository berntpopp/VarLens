import { onKeyStroke } from '@vueuse/core'
import { isTextEntryFocused } from './useTableKeyboardNav'
import { SHORTCUTS, type ShortcutActions } from '../config/keyboardShortcuts'

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
    if (isTextEntryFocused()) return
    e.preventDefault()
    callback?.()
  })
}

/**
 * Bind the app-wide shortcuts to their actions. Alt+Shift+O is import, not
 * Alt+Shift+I, which opens Chrome's "Report an issue" form on Windows/Linux.
 */
export function useKeyboardShortcuts(actions: ShortcutActions): void {
  onAltShift('KeyD', actions.disclaimer)
  onAltShift('KeyQ', actions.faq)
  onAltShift('KeyL', actions.logViewer)
  onAltShift('KeyC', actions.toggleColumns)
  onAltShift('KeyO', actions.import)

  onKeyStroke('F', (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault()
      actions.toggleFilters?.()
    }
  })

  onKeyStroke(SHORTCUTS.search.key, (e: KeyboardEvent) => {
    if (isTextEntryFocused()) return
    e.preventDefault()
    actions.search?.()
  })

  onKeyStroke(SHORTCUTS.help.key, (e: KeyboardEvent) => {
    if (isTextEntryFocused()) return
    e.preventDefault()
    actions.help?.()
  })

  // Clear all filters: Ctrl/Cmd+Shift+X
  if (actions.clearFilters) {
    onKeyStroke('X', (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault()
        actions.clearFilters!()
      }
    })
  }

  // Command palette: Ctrl/Cmd+K, also from a text field (like other palettes).
  if (actions.palette) {
    onKeyStroke(
      (e) => e.code === 'KeyK' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey,
      (e: KeyboardEvent) => {
        e.preventDefault()
        actions.palette!()
      }
    )
  }
}
