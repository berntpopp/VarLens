/** User-facing copy and accessible names for renderer panels and drawers. */

export const COLUMNS_DRAWER_COPY = {
  drawer: 'Column options',
  column: (title: string): string => `Show ${title}`,
  group: (label: string): string => `Show all ${label} columns`
} as const

export const PROTEIN_VIEW_COPY = {
  lengthUnknown: 'Protein length unknown, so the plot is unavailable.'
} as const
