/**
 * Utility for merging DB-imported transcripts with VEP API transcripts
 * into a unified list with provenance tracking.
 */

import { isTranscriptImpact, type TranscriptAnnotation } from '../../../shared/types/transcript'
import type { VepTranscriptConsequence } from '../../../shared/types/vep'

/** Where a transcript row came from */
export type TranscriptSource = 'imported' | 'vep' | 'both'

/** Unified transcript row combining DB and VEP data */
export interface UnifiedTranscriptRow {
  /** Normalized transcript ID (version stripped) */
  transcript_id: string
  /** Original transcript ID from source (may include version) */
  original_id: string
  gene_symbol: string | null
  consequence: string | null
  impact: string | null
  /** Sequence Ontology term (missense_variant, stop_gained, ...), joined if multiple. */
  func: string | null
  consequence_terms: string[] | null
  cdna: string | null
  aa_change: string | null
  is_selected: boolean
  is_mane_select: boolean | null
  is_canonical: boolean | null
  biotype: string | null
  source: TranscriptSource
  /** VEP transcript source: "Ensembl" or "RefSeq" (from merged=1 mode) */
  vep_source: string | null
  /** Original DB row if available */
  _dbRow: TranscriptAnnotation | null
  /** Original VEP row if available */
  _vepRow: VepTranscriptConsequence | null
}

/** Impact severity for sorting (lower = more severe) */
const IMPACT_ORDER: Record<string, number> = {
  HIGH: 0,
  MODERATE: 1,
  LOW: 2,
  MODIFIER: 3
}

/**
 * Strip version suffix from transcript ID.
 * ENST00000357654.9 → ENST00000357654
 */
export function normalizeTranscriptId(id: string): string {
  const dotIndex = id.lastIndexOf('.')
  if (dotIndex === -1) return id
  // Only strip if what follows the dot looks like a version number
  const suffix = id.substring(dotIndex + 1)
  if (/^\d+$/.test(suffix)) {
    return id.substring(0, dotIndex)
  }
  return id
}

/**
 * Merge DB-imported transcripts with VEP API transcripts.
 *
 * - DB rows are authoritative for selection state, cdna, aa_change
 * - VEP rows provide impact, consequence_terms, biotype, MANE/canonical flags
 * - Overlapping IDs get source: 'both' with merged data
 * - Sort: selected → MANE → canonical → impact severity → alphabetical
 */
export function mergeTranscripts(
  dbTranscripts: TranscriptAnnotation[],
  vepTranscripts: VepTranscriptConsequence[]
): UnifiedTranscriptRow[] {
  const map = new Map<string, UnifiedTranscriptRow>()

  // Insert DB rows first (authoritative)
  for (const db of dbTranscripts) {
    const normId = normalizeTranscriptId(db.transcript_id)
    map.set(normId, {
      transcript_id: normId,
      original_id: db.transcript_id,
      gene_symbol: db.gene_symbol,
      consequence: db.consequence,
      impact: isTranscriptImpact(db.consequence) ? db.consequence : null,
      func: db.func,
      consequence_terms: null,
      cdna: db.cdna,
      aa_change: db.aa_change,
      is_selected: db.is_selected,
      is_mane_select: db.is_mane_select,
      is_canonical: db.is_canonical,
      biotype: null,
      source: 'imported',
      vep_source: null,
      _dbRow: db,
      _vepRow: null
    })
  }

  // Merge or append VEP rows
  for (const vep of vepTranscripts) {
    const normId = normalizeTranscriptId(vep.transcript_id)
    const existing = map.get(normId)

    if (existing !== undefined) {
      // Merge: VEP enriches the existing DB row
      existing.source = 'both'
      existing._vepRow = vep
      existing.vep_source = vep.source ?? null
      existing.impact = vep.impact ?? null
      existing.consequence_terms = vep.consequence_terms ?? null
      existing.func =
        vep.consequence_terms.length > 0 ? vep.consequence_terms.join(', ') : existing.func
      existing.biotype = vep.biotype ?? null
      // Fill in MANE/canonical from VEP if DB didn't have them
      if (existing.is_mane_select === null && vep.mane_select !== undefined) {
        existing.is_mane_select = true
      }
      if (existing.is_canonical === null && vep.canonical !== undefined) {
        existing.is_canonical = vep.canonical === 1
      }
    } else {
      // New VEP-only transcript
      map.set(normId, {
        transcript_id: normId,
        original_id: vep.transcript_id,
        gene_symbol: vep.gene_symbol ?? null,
        consequence: vep.impact ?? null,
        impact: vep.impact ?? null,
        func: vep.consequence_terms.length > 0 ? vep.consequence_terms.join(', ') : null,
        consequence_terms: vep.consequence_terms ?? null,
        cdna: null,
        aa_change: null,
        is_selected: false,
        is_mane_select: vep.mane_select !== undefined ? true : null,
        is_canonical: vep.canonical !== undefined ? vep.canonical === 1 : null,
        biotype: vep.biotype ?? null,
        source: 'vep',
        vep_source: vep.source ?? null,
        _dbRow: null,
        _vepRow: vep
      })
    }
  }

  // Sort: selected → MANE → canonical → impact severity → alphabetical
  const rows = Array.from(map.values())
  rows.sort((a, b) => {
    // Selected first
    if (a.is_selected !== b.is_selected) return a.is_selected ? -1 : 1

    // MANE Select next
    const aMane = a.is_mane_select === true ? 1 : 0
    const bMane = b.is_mane_select === true ? 1 : 0
    if (aMane !== bMane) return bMane - aMane

    // Canonical next
    const aCanon = a.is_canonical === true ? 1 : 0
    const bCanon = b.is_canonical === true ? 1 : 0
    if (aCanon !== bCanon) return bCanon - aCanon

    // Impact severity (HIGH < MODERATE < LOW < MODIFIER < null)
    const aImpact = a.impact !== null ? (IMPACT_ORDER[a.impact] ?? 99) : 99
    const bImpact = b.impact !== null ? (IMPACT_ORDER[b.impact] ?? 99) : 99
    if (aImpact !== bImpact) return aImpact - bImpact

    // Alphabetical by transcript_id
    return a.transcript_id.localeCompare(b.transcript_id)
  })

  return rows
}
