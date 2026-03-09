export const APP_CONFIG = {
  /** Default window dimensions */
  WINDOW_WIDTH: 1440,
  WINDOW_HEIGHT: 900,
  /** Max log entries in renderer */
  MAX_LOG_ENTRIES: 1000,
  /** Default debounce delay (ms) */
  DEBOUNCE_MS: 300,
  /** Snackbar timeout for success messages (ms) */
  SNACKBAR_SUCCESS_MS: 3000,
  /** Snackbar timeout for error messages (-1 = manual close) */
  SNACKBAR_ERROR_MS: -1,
  /** Default items-per-page options */
  ITEMS_PER_PAGE_OPTIONS: [10, 25, 50, 100] as readonly number[]
} as const
