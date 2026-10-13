/**
 * Presentation constants shared by every data surface (tables, panels,
 * shortlist), so one value changes the whole app.
 */

/** Shown for null/undefined/empty values in tables and data displays */
export const EMPTY_VALUE_PLACEHOLDER = '--'

/** Joins several consequence labels of one call */
export const CONSEQUENCE_JOIN = ', '

/** Joins the parts of a one-line summary, e.g. "LMNA · p.Arg453Trp" */
export const INLINE_SEPARATOR = ' · '

/** Shown in compact one-line summaries for a missing numeric value (e.g. CN=?) */
export const UNKNOWN_VALUE_GLYPH = '?'

/** Details-panel title for a call with neither a gene symbol nor an STR repeat id */
export const NO_GENE_LABEL = 'Unknown Gene'

/**
 * Map of consequence types to human-readable labels
 * Based on Sequence Ontology terms used in VEP/Ensembl
 */
export const CONSEQUENCE_LABELS: Readonly<Record<string, string>> = {
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

/** Chip colour of a variant's most severe SO consequence: truncating/splice → error, missense/inframe → warning. */
export function consequenceChipColor(consequence: string): string {
  if (/frameshift|stop_gained|splice_donor|splice_acceptor/.test(consequence)) return 'error'
  if (/missense|inframe/.test(consequence)) return 'warning'
  return 'muted'
}
