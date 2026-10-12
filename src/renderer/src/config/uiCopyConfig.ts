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

/**
 * Cohort carrier frequency (#555): carriers ÷ cases of the same genome build
 * with calls of the same variant class. Same wording in the case and cohort
 * views; the column help in ./columnHelp.ts carries the long form.
 */
export const CARRIER_FREQUENCY_COPY = {
  panel: 'Cohort carrier freq.',
  chip: 'Carrier freq.',
  column: 'Cohort carrier freq.',
  placeholder: 'Max carrier freq. % (e.g. 5)',
  hint: 'Patients in this database (relatives included), not a population. Not for BA1, BS1 or PM2.',
  stale:
    'Cohort counts are being rebuilt: carrier frequency and carrier filters may be out of date.',
  maxCarriersLabel: 'Seen in at most N cases',
  maxCarriersHint: {
    case: 'Counts cases of this genome build in this database, including this case.',
    cohort: 'Counts cases of the variant’s genome build that carry it.'
  }
} as const

/** Preset caps of the carrier-frequency filter (fractions), both drawers. */
export const CARRIER_FREQUENCY_PRESETS = [
  { label: '<= 1%', value: 0.01 },
  { label: '<= 5%', value: 0.05 },
  { label: '<= 10%', value: 0.1 }
] as const
