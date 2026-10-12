/**
 * Pure layout rules behind `useResponsiveLayout`. Kept free of Vue/Vuetify so
 * the breakpoint maths is unit-testable without a mounted display.
 *
 * Breakpoints follow Vuetify's default thresholds: md 840, lg 1145, xl 1545.
 */

import { COLUMN_PRIORITY, MIN_AUTO_VISIBLE_COLUMNS } from '../config/columnPriority'

/** Viewport width (CSS px) at which the details panel docks beside the table. */
export const DETAIL_PANEL_DOCK_MIN_WIDTH = 1440

/** The details panel never takes more than this fraction of the viewport. */
export const DETAIL_PANEL_MAX_VIEWPORT_FRACTION = 0.45

export const DETAIL_PANEL_MIN_WIDTH = 300
export const DETAIL_PANEL_MAX_WIDTH = 800

/** Docked panels shrink the main area; overlays below this width would cover the table. */
export function isDetailPanelDocked(viewportWidth: number): boolean {
  return viewportWidth >= DETAIL_PANEL_DOCK_MIN_WIDTH
}

/**
 * Effective details-panel width: the user's resized width, capped at
 * `min(800px, 45vw)` so the panel can never cover most of the table. Narrow
 * viewports (full-width overlay) are handled by the caller.
 */
export function clampDetailPanelWidth(requestedWidth: number, viewportWidth: number): number {
  const viewportCap = Math.floor(viewportWidth * DETAIL_PANEL_MAX_VIEWPORT_FRACTION)
  const upper = Math.max(DETAIL_PANEL_MIN_WIDTH, Math.min(DETAIL_PANEL_MAX_WIDTH, viewportCap))
  return Math.max(DETAIL_PANEL_MIN_WIDTH, Math.min(upper, requestedWidth))
}

export const FILTER_DRAWER_MIN_WIDTH = 250
export const FILTER_DRAWER_MAX_WIDTH = 500

/**
 * Effective filter-drawer width: the user's preferred width capped at
 * `min(500px, 40vw)`, or the full viewport when 40vw is below the 250 px
 * minimum. The preferred width is an input only, so a temporarily narrow
 * window never overwrites the stored desktop preference.
 */
export function filterDrawerWidth(preferredWidth: number, viewportWidth: number): number {
  const cap = Math.min(FILTER_DRAWER_MAX_WIDTH, Math.floor(viewportWidth * 0.4))
  if (cap < FILTER_DRAWER_MIN_WIDTH) return viewportWidth
  return Math.max(FILTER_DRAWER_MIN_WIDTH, Math.min(cap, preferredWidth))
}

/** Structural columns that never count against the budget and are never auto-hidden. */
const ALWAYS_SHOWN_COLUMNS: ReadonlySet<string> = new Set(['data-table-expand', 'annotations'])

export function getColumnPriority(key: string): number {
  return COLUMN_PRIORITY[key] ?? 100
}

/**
 * Keys auto-hidden when the table is `availableRem` wide. Data columns are
 * taken in priority order (ties keep their table order) while they fit next to
 * the structural columns; the first column that does not fit and everything
 * ranked after it are hidden, so a default view never shows a column cut off at
 * the table edge (a clipped "0.0193" reads as "0.0"). The top
 * `MIN_AUTO_VISIBLE_COLUMNS` are kept even when they overflow (phones).
 * Columns with an explicit visibility preference are left out entirely — they
 * neither consume nor receive width — so a user choice is never overridden,
 * and showing one column never silently hides another.
 */
export function computeAutoHiddenColumns(
  keys: readonly string[],
  availableRem: number,
  widthRem: (key: string) => number,
  explicit: Readonly<Record<string, boolean>> = {}
): Set<string> {
  if (!Number.isFinite(availableRem)) return new Set()
  let usedRem = keys
    .filter((key) => ALWAYS_SHOWN_COLUMNS.has(key))
    .reduce((sum, key) => sum + widthRem(key), 0)
  const ranked = keys
    .map((key, index) => ({ key, index }))
    .filter(({ key }) => !ALWAYS_SHOWN_COLUMNS.has(key) && !(key in explicit))
    .sort((a, b) => getColumnPriority(a.key) - getColumnPriority(b.key) || a.index - b.index)
  const hidden = new Set<string>()
  for (const [rank, { key }] of ranked.entries()) {
    usedRem += widthRem(key)
    if (hidden.size > 0 || (rank >= MIN_AUTO_VISIBLE_COLUMNS && usedRem > availableRem)) {
      hidden.add(key)
    }
  }
  return hidden
}

/** Explicit preference first, then the responsive default. */
export function isColumnVisible(
  key: string,
  explicit: Readonly<Record<string, boolean>>,
  autoHidden: ReadonlySet<string>
): boolean {
  const pref = explicit[key]
  if (pref !== undefined) return pref
  return !autoHidden.has(key)
}
