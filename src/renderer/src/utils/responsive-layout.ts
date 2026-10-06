/**
 * Pure layout rules behind `useResponsiveLayout`. Kept free of Vue/Vuetify so
 * the breakpoint maths is unit-testable without a mounted display.
 *
 * Breakpoints follow Vuetify's default thresholds: md 840, lg 1145, xl 1545.
 */

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

/**
 * Number of data columns shown by default at a viewport width. Explicit user
 * column choices always win over this budget (see `isColumnVisible`).
 */
export function getMaxAutoVisibleColumns(viewportWidth: number): number {
  if (viewportWidth < 840) return 5
  if (viewportWidth < 1145) return 10
  if (viewportWidth < 1545) return 14
  return Infinity
}

/**
 * Column priority for auto-hide (lower = more important, kept first). Shared by
 * the case and cohort tables; cohort-only keys sit next to their case-table
 * equivalents. Unknown keys (link-out and extension columns) get the lowest
 * priority, so they are the first to be auto-hidden.
 */
export const COLUMN_PRIORITY: Readonly<Record<string, number>> = {
  gene_symbol: 1,
  consequence: 2,
  clinvar: 3,
  gnomad_af: 4,
  cadd: 5,
  cadd_phred: 5,
  annotations: 6,
  func: 7,
  chr: 8,
  pos: 9,
  ref: 10,
  alt: 11,
  gt_num: 12,
  carrier_count: 12,
  aa_change: 13,
  cdna: 14,
  cohort_frequency: 14,
  transcript: 15,
  het_count: 15,
  omim_mim_number: 16,
  hpo_sim_score: 17,
  qual: 18,
  moi: 19
}

/** Structural columns that never count against the budget and are never auto-hidden. */
const ALWAYS_SHOWN_COLUMNS: ReadonlySet<string> = new Set(['data-table-expand', 'annotations'])

export function getColumnPriority(key: string): number {
  return COLUMN_PRIORITY[key] ?? 100
}

/**
 * Keys auto-hidden at the given budget: every column beyond the `maxVisible`
 * most important ones (ties keep their table order). Columns with an explicit
 * visibility preference are left out of the ranking entirely — they neither
 * consume nor receive budget — so a user choice is never overridden, and
 * showing one column never silently hides another.
 */
export function computeAutoHiddenColumns(
  keys: readonly string[],
  maxVisible: number,
  explicit: Readonly<Record<string, boolean>> = {}
): Set<string> {
  if (!Number.isFinite(maxVisible)) return new Set()
  const ranked = keys
    .map((key, index) => ({ key, index }))
    .filter(({ key }) => !ALWAYS_SHOWN_COLUMNS.has(key) && !(key in explicit))
    .sort((a, b) => getColumnPriority(a.key) - getColumnPriority(b.key) || a.index - b.index)
  return new Set(ranked.slice(Math.max(0, maxVisible)).map(({ key }) => key))
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
