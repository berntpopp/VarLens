/**
 * The one list of keyboard shortcuts: the Keyboard Shortcuts dialog renders
 * SHORTCUT_GROUPS and tooltips/menus take their hint from SHORTCUTS, so the
 * two cannot drift. Bindings live in useKeyboardShortcuts / useTableKeyboardNav.
 */

export interface Shortcut {
  key: string
  description: string
}

const isMac =
  typeof navigator !== 'undefined' &&
  typeof navigator.platform === 'string' &&
  navigator.platform.toUpperCase().includes('MAC')
const MOD = isMac ? 'Cmd' : 'Ctrl'
const ALT = isMac ? 'Option' : 'Alt'

export const SHORTCUTS = {
  moveSelection: { key: '↑ / ↓', description: 'Move selection up / down' },
  openDetails: { key: 'Enter', description: 'Open variant detail panel' },
  closeDetails: { key: 'Escape', description: 'Close detail panel / deselect row' },
  star: { key: 's', description: 'Toggle star' },
  comment: { key: 'c', description: 'Open comment dialog' },
  acmg: { key: 'a', description: 'Open ACMG classification' },
  expandRow: { key: 'e', description: 'Expand / collapse row (Cohort)' },
  search: { key: '/', description: 'Focus search field' },
  toggleFilters: { key: `${MOD}+Shift+F`, description: 'Toggle filter panel' },
  toggleColumns: { key: `${ALT}+Shift+C`, description: 'Toggle columns panel' },
  clearFilters: { key: `${MOD}+Shift+X`, description: 'Clear all filters' },
  closeDrawer: { key: 'Escape', description: 'Close drawer / blur search' },
  help: { key: '?', description: 'Show this help' },
  import: { key: `${ALT}+Shift+O`, description: 'Import data' },
  logViewer: { key: `${ALT}+Shift+L`, description: 'Toggle log viewer' },
  disclaimer: { key: `${ALT}+Shift+D`, description: 'Show disclaimer' },
  faq: { key: `${ALT}+Shift+Q`, description: 'Show FAQ' }
} as const satisfies Record<string, Shortcut>

export type ShortcutId = keyof typeof SHORTCUTS

const s = SHORTCUTS
export const SHORTCUT_GROUPS: ReadonlyArray<{ title: string; shortcuts: readonly Shortcut[] }> = [
  { title: 'Table Navigation', shortcuts: [s.moveSelection, s.openDetails, s.closeDetails] },
  { title: 'Actions (on selected row)', shortcuts: [s.star, s.comment, s.acmg, s.expandRow] },
  {
    title: 'Search & Filters',
    shortcuts: [s.search, s.toggleFilters, s.toggleColumns, s.clearFilters, s.closeDrawer]
  },
  { title: 'General', shortcuts: [s.help, s.import, s.logViewer, s.disclaimer, s.faq] }
]

/** Tooltip text with its shortcut: `withShortcut('Filters', 'toggleFilters')` → "Filters (Ctrl+Shift+F)". */
export function withShortcut(label: string, id: ShortcutId): string {
  return `${label} (${SHORTCUTS[id].key})`
}
