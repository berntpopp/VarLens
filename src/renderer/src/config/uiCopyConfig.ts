/** User-facing copy and accessible names for renderer panels and drawers. */

export const COLUMNS_DRAWER_COPY = {
  drawer: 'Column options',
  column: (title: string): string => `Show ${title}`,
  group: (label: string): string => `Show all ${label} columns`
} as const

export const PROTEIN_VIEW_COPY = {
  lengthUnknown: 'Protein length unknown, so the plot is unavailable.'
} as const

/** Per-sample call fields shown under the locus in the details panel, in order. */
export const CALL_QUALITY_FIELDS: ReadonlyArray<{ key: string; label: string; digits?: number }> = [
  { key: 'gt_num', label: 'GT' },
  { key: 'dp', label: 'DP' },
  { key: 'gq', label: 'GQ' },
  { key: 'ab', label: 'AB', digits: 2 },
  { key: 'filter', label: 'FILTER' }
]
