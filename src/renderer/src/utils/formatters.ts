/**
 * Formatting utilities for displaying variant data in human-readable format
 */

import { decodeVepHgvs } from '../../../shared/utils/hgvs'
import {
  CONSEQUENCE_LABELS,
  CONSEQUENCE_JOIN,
  INLINE_SEPARATOR,
  NO_GENE_LABEL
} from '../config/displayConfig'
import { VEP_CONSEQUENCE_SEPARATOR } from '../../../shared/config/vep.config'

/**
 * Format a consequence type to human-readable form
 * @param raw - The raw consequence string from the database
 * @returns Human-readable consequence name
 */
export function formatConsequence(raw: string): string {
  if (!raw) return ''
  return raw
    .split(VEP_CONSEQUENCE_SEPARATOR)
    .map((term) => CONSEQUENCE_LABELS[term] || term.replace(/_/g, ' '))
    .join(CONSEQUENCE_JOIN)
}

/**
 * One HGVS display string for every surface (tables, panel, Copy). VEP values
 * are already `ENST….7:c.…` (the only place the transcript version lives), so
 * the transcript is prefixed only onto bare SnpEff/JSON `c.…` values. Decoding
 * here also fixes databases imported before VEP escapes were decoded at import.
 */
export function formatHgvs(
  value: string | null | undefined,
  transcript?: string | null
): string | null {
  if (value === null || value === undefined || value === '') return null
  const decoded = decodeVepHgvs(value)
  const hasTranscript = transcript !== null && transcript !== undefined && transcript !== ''
  return hasTranscript && !decoded.includes(':') ? `${transcript}:${decoded}` : decoded
}

interface NamedVariant {
  gene_symbol?: string | null
  _str_repeat_id?: string | null
  aa_change?: string | null
  cdna?: string | null
}

/** A call's name: its gene symbol, else an STR repeat id (e.g. FMR1_CGG), else NO_GENE_LABEL. */
export function variantName(variant: NamedVariant): string {
  const names = [variant.gene_symbol, variant._str_repeat_id]
  return names.find((name) => name !== null && name !== undefined && name !== '') ?? NO_GENE_LABEL
}

/** Details-panel heading: the name plus the protein change, else the cDNA change. */
export function variantHeading(variant: NamedVariant | null): string {
  if (variant === null) return NO_GENE_LABEL
  const change = formatHgvs(variant.aa_change) ?? formatHgvs(variant.cdna)
  return change === null
    ? variantName(variant)
    : `${variantName(variant)}${INLINE_SEPARATOR}${change}`
}
