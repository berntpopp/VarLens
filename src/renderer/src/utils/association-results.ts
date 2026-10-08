/**
 * Text of a gene burden result: the assumption every result states, the
 * excluded sites of a gene, and the TSV export.
 */

/** Shown with every result and written into every export. VarLens stores no callability. */
export const BURDEN_REFERENCE_NOTE =
  'Samples without a stored call are treated as reference. ' +
  'Use data called and filtered the same way for both groups.'

/** Sites left out of a gene, per reason (SiteExclusionCounts in src/main/statistics/types.ts). */
export interface SitesExcluded {
  missing_call: number
  conflicting_calls: number
  no_called_alleles: number
}

export interface AssociationResultRow {
  gene_symbol: string
  /** Sites used: eligible sites with a known call in every selected sample. */
  n_variants: number
  sites_excluded: SitesExcluded
  groupA_carriers: number
  groupB_carriers: number
  groupA_total: number
  groupB_total: number
  fisher: {
    p_value: number | null
    odds_ratio: number | null
    ci_lower: number | null
    ci_upper: number | null
  }
  logistic_burden: {
    p_value: number | null
    beta: number | null
    se: number | null
    ci_lower: number | null
    ci_upper: number | null
    used_firth: boolean
    warning?: string
  }
  q_value: number | null
}

export function excludedSiteCount(excluded: SitesExcluded): number {
  return excluded.missing_call + excluded.conflicting_calls + excluded.no_called_alleles
}

export function excludedSitesLabel(excluded: SitesExcluded): string {
  return (
    `Missing call: ${excluded.missing_call}, ` +
    `conflicting calls: ${excluded.conflicting_calls}, ` +
    `no called alleles: ${excluded.no_called_alleles}`
  )
}

/** Why a run can be smaller than the filters suggest, or empty; null when nothing was left out. */
export function nonAutosomalNote(count: number): string | null {
  if (count <= 0) return null
  return count === 1
    ? '1 qualifying variant was left out because it is not on chromosomes 1-22.'
    : `${count} qualifying variants were left out because they are not on chromosomes 1-22.`
}

const TSV_HEADER = [
  'Gene',
  'Variants',
  'Cases_A',
  'Cases_B',
  'Fisher_OR',
  'Fisher_CI_Lower',
  'Fisher_CI_Upper',
  'Fisher_p',
  'Burden_beta',
  'Burden_SE',
  'Burden_p',
  'q_value',
  'Excluded_missing_call',
  'Excluded_conflicting_calls',
  'Excluded_no_called_alleles'
]

/** The results as TSV. `#` comment lines first: the stated assumption, then the non-autosomal count. */
export function buildAssociationTsv(
  results: AssociationResultRow[],
  nonAutosomalVariants = 0
): string {
  const rows = results.map((r) =>
    [
      r.gene_symbol,
      r.n_variants,
      r.groupA_carriers,
      r.groupB_carriers,
      r.fisher.odds_ratio ?? '',
      r.fisher.ci_lower ?? '',
      r.fisher.ci_upper ?? '',
      r.fisher.p_value ?? '',
      r.logistic_burden.beta ?? '',
      r.logistic_burden.se ?? '',
      r.logistic_burden.p_value ?? '',
      r.q_value ?? '',
      r.sites_excluded.missing_call,
      r.sites_excluded.conflicting_calls,
      r.sites_excluded.no_called_alleles
    ].join('\t')
  )
  const skipped = nonAutosomalNote(nonAutosomalVariants)
  const comments = [BURDEN_REFERENCE_NOTE, ...(skipped === null ? [] : [skipped])]
  return [...comments.map((line) => `# ${line}`), TSV_HEADER.join('\t'), ...rows].join('\n')
}
