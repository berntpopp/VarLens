/**
 * The one list of keyboard shortcuts: the Keyboard Shortcuts dialog renders
 * SHORTCUT_GROUPS and tooltips/menus take their hint from SHORTCUTS, so the
 * two cannot drift. Bindings live in useKeyboardShortcuts / useTableKeyboardNav.
 */

export interface Shortcut {
  key: string
  description: string
  /** Tooltip hint when the bare key would mislead (row keys act on the selected row). */
  hint?: string
}

const isMac =
  typeof navigator !== 'undefined' &&
  typeof navigator.platform === 'string' &&
  navigator.platform.toUpperCase().includes('MAC')
const MOD = isMac ? 'Cmd' : 'Ctrl'
const ALT = isMac ? 'Option' : 'Alt'

/** Row keys act on the keyboard-selected row, not the row under the pointer. */
const rowKey = (key: string, description: string, effect?: string): Shortcut => ({
  key,
  description,
  hint: `${key} on selected row${effect === undefined ? '' : `: ${effect}`}`
})

export const SHORTCUTS = {
  moveSelection: { key: '↑ / ↓', description: 'Move selection up / down' },
  openDetails: { key: 'Enter', description: 'Open variant detail panel' },
  closeDetails: { key: 'Escape', description: 'Close detail panel / deselect row' },
  star: rowKey('s', 'Toggle star'),
  comment: rowKey('c', 'Open comment dialog'),
  // The ACMG cell button opens the quick menu; the key opens the evidence dialog.
  acmg: rowKey('a', 'Open ACMG evidence dialog', 'evidence dialog'),
  proteinView: rowKey('p', 'Open protein view (lollipop, gene, 3D)', 'protein view'),
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
  {
    title: 'Actions (on selected row)',
    shortcuts: [s.star, s.comment, s.acmg, s.proteinView, s.expandRow]
  },
  {
    title: 'Search & Filters',
    shortcuts: [s.search, s.toggleFilters, s.toggleColumns, s.clearFilters, s.closeDrawer]
  },
  { title: 'General', shortcuts: [s.help, s.import, s.logViewer, s.disclaimer, s.faq] }
]

/** Tooltip text with its shortcut: `withShortcut('Filters', 'toggleFilters')` → "Filters (Ctrl+Shift+F)". */
export function withShortcut(label: string, id: ShortcutId): string {
  const shortcut: Shortcut = SHORTCUTS[id]
  return `${label} (${shortcut.hint ?? shortcut.key})`
}
