/**
 * Formatting utilities for displaying variant data in human-readable format
 */

/** Placeholder displayed for null/undefined/missing values in tables and data display */
export const EMPTY_VALUE_PLACEHOLDER = '--'

/**
 * Map of consequence types to human-readable labels
 * Based on Sequence Ontology terms used in VEP/Ensembl
 */
const consequenceDisplayMap: Record<string, string> = {
  // Truncating variants (HIGH impact)
  stop_gained: 'Stop Gained',
  frameshift_truncation: 'Frameshift',
  frameshift_elongation: 'Frameshift',
  frameshift_variant: 'Frameshift',
  splice_acceptor_variant: 'Splice Acceptor',
  splice_donor_variant: 'Splice Donor',
  start_lost: 'Start Lost',
  stop_lost: 'Stop Lost',

  // Missense / Inframe (MODERATE impact)
  missense_variant: 'Missense',
  inframe_indel: 'Inframe Indel',
  inframe_deletion: 'Inframe Del',
  inframe_insertion: 'Inframe Ins',
  disruptive_inframe_deletion: 'Disruptive Inframe Del',
  disruptive_inframe_insertion: 'Disruptive Inframe Ins',

  // Splice region
  splice_region_variant: 'Splice Region',

  // Synonymous (LOW impact)
  synonymous_variant: 'Synonymous',
  stop_retained_variant: 'Stop Retained',

  // UTR variants
  '3_prime_UTR_exon_variant': "3' UTR",
  '3_prime_UTR_intron_variant': "3' UTR Intron",
  '5_prime_UTR_exon_variant': "5' UTR",
  '5_prime_UTR_intron_variant': "5' UTR Intron",

  // Intronic
  coding_transcript_intron_variant: 'Intron',
  non_coding_transcript_intron_variant: 'NC Intron',

  // Non-coding other
  non_coding_transcript_exon_variant: 'NC Exon',
  upstream_gene_variant: 'Upstream',
  downstream_gene_variant: 'Downstream',
  intergenic_variant: 'Intergenic',

  // Complex
  complex_substitution: 'Complex',
  direct_tandem_duplication: 'Tandem Dup',
  mnv: 'MNV'
}

/**
 * Format a consequence type to human-readable form
 * @param raw - The raw consequence string from the database
 * @returns Human-readable consequence name
 */
export function formatConsequence(raw: string): string {
  if (!raw) return ''
  return consequenceDisplayMap[raw] || raw.replace(/_/g, ' ')
}

/**
 * Format multiple consequences (comma-separated) to human-readable form
 * @param raw - Comma-separated consequence string
 * @returns Formatted consequence string
 */
export function formatConsequences(raw: string): string {
  if (!raw) return ''
  return raw
    .split(',')
    .map((c) => formatConsequence(c.trim()))
    .join(', ')
}

/**
 * Get the original consequence value (for tooltips)
 * @param formatted - The formatted consequence
 * @returns Original database value or the input if not found
 */
export function getOriginalConsequence(formatted: string): string | null {
  for (const [key, value] of Object.entries(consequenceDisplayMap)) {
    if (value === formatted) return key
  }
  return null
}
