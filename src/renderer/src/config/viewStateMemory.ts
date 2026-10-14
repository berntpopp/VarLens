/** Per-case / cohort view-state memory (#124): where it lives and how much it keeps. */
export const VIEW_STATE_MEMORY = {
  /** One localStorage entry holding every remembered view, oldest first. */
  storageKey: 'varlens.viewState.v1',
  /** Least recently written views are dropped beyond this many. */
  maxEntries: 200
} as const
