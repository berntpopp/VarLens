export const TRANSCRIPT_IMPACT_VALUES = ['HIGH', 'MODERATE', 'LOW', 'MODIFIER'] as const

export function isTranscriptImpact(
  value: unknown
): value is (typeof TRANSCRIPT_IMPACT_VALUES)[number] {
  return (
    typeof value === 'string' &&
    TRANSCRIPT_IMPACT_VALUES.includes(value as (typeof TRANSCRIPT_IMPACT_VALUES)[number])
  )
}

/** Canonicalize imported IMPACT/SO fields without discarding a legacy SO value. */
export function canonicalizeTranscriptSemantics(
  consequence: string | null,
  func: string | null
): { consequence: (typeof TRANSCRIPT_IMPACT_VALUES)[number] | null; func: string | null } {
  const canonicalImpact = isTranscriptImpact(consequence)
    ? consequence
    : isTranscriptImpact(func)
      ? func
      : null
  const canonicalFunc =
    func !== null && !isTranscriptImpact(func)
      ? func
      : consequence !== null && !isTranscriptImpact(consequence)
        ? consequence
        : null

  return { consequence: canonicalImpact, func: canonicalFunc }
}

/**
 * TranscriptAnnotation — full row from variant_transcripts table.
 * Returned by getVariantTranscripts() to the renderer.
 */
export interface TranscriptAnnotation {
  id: number
  variant_id: number
  transcript_id: string
  gene_symbol: string | null
  /** IMPACT level (HIGH/MODERATE/LOW/MODIFIER) — same convention as variants.consequence. */
  consequence: string | null
  /** Sequence Ontology term (missense_variant, stop_gained, ...) — same convention as variants.func. */
  func: string | null
  cdna: string | null
  aa_change: string | null
  hpo_sim_score: number | null
  moi: string | null
  is_selected: boolean
  is_mane_select: boolean | null
  is_canonical: boolean | null
}

/**
 * TranscriptInsertRow — data for inserting into variant_transcripts.
 * Used by the import pipeline (no id or variant_id yet).
 */
export interface TranscriptInsertRow {
  transcript_id: string
  gene_symbol: string | null
  /** IMPACT level (HIGH/MODERATE/LOW/MODIFIER) — same convention as variants.consequence. */
  consequence: string | null
  /** Sequence Ontology term (missense_variant, stop_gained, ...) — same convention as variants.func. */
  func: string | null
  cdna: string | null
  aa_change: string | null
  hpo_sim_score: number | null
  moi: string | null
  is_selected: number // 0 or 1 (SQLite integer boolean)
}
