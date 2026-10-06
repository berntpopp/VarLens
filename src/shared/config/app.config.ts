export const APP_CONFIG = {
  /** Default window dimensions */
  WINDOW_WIDTH: 1440,
  WINDOW_HEIGHT: 900,
  /** Minimum window size: below this the case view chrome leaves no table rows */
  WINDOW_MIN_WIDTH: 1024,
  WINDOW_MIN_HEIGHT: 640,
  /** Max log entries in renderer */
  MAX_LOG_ENTRIES: 1000,
  /** Default debounce delay (ms) */
  DEBOUNCE_MS: 300,
  /** Snackbar timeout for success messages (ms) */
  SNACKBAR_SUCCESS_MS: 3000,
  /** Snackbar timeout for error messages (-1 = manual close) */
  SNACKBAR_ERROR_MS: -1,
  /** Default items-per-page options */
  ITEMS_PER_PAGE_OPTIONS: [10, 25, 50, 100] as readonly number[],
  /** External URLs */
  URLS: {
    GITHUB: 'https://github.com/berntpopp/varlens',
    DOCS: 'https://berntpopp.github.io/VarLens/',
    LICENSE: 'https://opensource.org/licenses/MIT'
  }
} as const
