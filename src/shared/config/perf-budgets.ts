/**
 * Performance budgets for key VarLens interactions.
 *
 * Warning thresholds, not hard limits. When an interaction exceeds
 * its budget, the perf trace logs a warning in dev mode.
 * All values in milliseconds.
 */
export const PERF_BUDGETS = {
  /** Cold start: app launch to renderer reports interactive */
  STARTUP_TO_INTERACTIVE: 3000,
  /** Case switch: selecting a different case to rows + annotations visible */
  CASE_SWITCH: 1000,
  /** Filter apply: changing a filter to updated rows + annotations visible */
  FILTER_APPLY: 500,
  /** Page navigation: clicking next/prev to rows + annotations visible */
  PAGE_NAVIGATE: 300,
  /** Sort change: clicking a column header to sorted rows visible */
  SORT_CHANGE: 500,
  /** Annotation hydration: loading annotations for a page of variants */
  ANNOTATION_HYDRATE: 200,
  /** Export initiation: from click to save dialog or progress start */
  EXPORT_START: 500
} as const

export type PerfBudgetKey = keyof typeof PERF_BUDGETS
