/** User-facing copy and accessible names for renderer panels and drawers. */

export const COLUMNS_DRAWER_COPY = {
  drawer: 'Column options',
  column: (title: string): string => `Show ${title}`,
  group: (label: string): string => `Show all ${label} columns`
} as const

/** Filter toolbar action labels (visible text, or the accessible name when icon-only). */
export const FILTER_TOOLBAR_COPY = {
  clear: 'Clear',
  filters: 'Filters'
} as const

/** Table empty state (case + cohort, #568): names each active filter so it can be removed. */
export const FILTER_EMPTY_STATE_COPY = {
  title: 'No variants match your filters',
  hint: 'These filters are active. Remove one to widen the results:',
  removeLabel: 'Remove filter',
  clearAll: 'Clear all filters',
  noFiltersTitle: 'No variants to show'
} as const

export const PROTEIN_VIEW_COPY = {
  lengthUnknown: 'Protein length unknown, so the plot is unavailable.'
} as const

/** Field labels in the details-panel identity block; ClinVar is named so its chip never reads as the user's own ACMG call. */
export const IDENTITY_COPY = {
  clinvar: 'ClinVar:',
  rsid: 'rsID:'
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

/** ClinGen VCEP gene-specific ACMG/AMP specification chip (#201, bundled CSpec snapshot). */
export const CLINGEN_SPEC_COPY = {
  chip: (id: string, several: boolean): string => (several ? `ClinGen VCEP ${id}` : 'ClinGen VCEP'),
  tooltip: (panel: string | null, version: string | null, retrieved: string): string =>
    `Gene-specific ACMG/AMP specification: ${panel ?? 'ClinGen VCEP'}${version === null ? '' : ` v${version}`}. Opens the ClinGen CSpec registry. Registry snapshot of ${retrieved}.`
} as const

/** Cohort details of an SV/CNV row: the summary holds no per-call evidence (#539). */
export const COHORT_CALL_EVIDENCE_NOTE =
  'Call metrics (support, VAF, copy number, quality) differ per carrier: expand the row to see each carrier’s call.'

/** The "Local IGV" action (#93). */
export const IGV_COPY = {
  tooltip: (locus: string, build: string | null): string =>
    `Jump to ${locus}${build === null ? '' : ` (${build})`} in local IGV (port 60151)`,
  sent: (locus: string): string => `Sent ${locus} to IGV.`,
  genome: (genomeId: string): string => `IGV must show ${genomeId}.`,
  unknownBuild: 'Genome build unknown: check that IGV shows the case’s genome.',
  unreachable:
    'IGV did not answer on port 60151. Start IGV desktop with its batch port enabled (View > Preferences > Advanced), then retry.',
  retry: 'Retry'
} as const

/** HPO data row: name and licence per reference source key of `HpoDataStatus.sources` (CNV/STR spec §3). */
export const HPO_DATA_SOURCE_ATTRIBUTION: Readonly<Record<string, string>> = {
  hpo: 'Human Phenotype Ontology',
  clingen: 'ClinGen Dosage Sensitivity (CC0)',
  strchive: 'STRchive (MIT)',
  mondo: 'Mondo (CC BY 4.0)'
}
