/**
 * VCF annotation parser
 *
 * Extracts CSQ (VEP) and ANN (SnpEff) annotations from VCF INFO fields.
 * Selects the "best" transcript and maps to VarLens fields.
 */

import type { VcfHeader, AnnotationResult } from './types'
import type { TranscriptInsertRow } from '../../../shared/types/transcript'
import {
  filterCsqTranscriptsByAllele,
  matchesAnnotationAllele,
  parseCsqTranscripts,
  selectBestCsqTranscript
} from '../../../shared/vcf/vcf-csq'

/** Impact severity order for transcript selection */
const IMPACT_ORDER: Record<string, number> = {
  HIGH: 4,
  MODERATE: 3,
  LOW: 2,
  MODIFIER: 1
}

/**
 * Parse annotations from VCF INFO fields.
 * Auto-dispatches to CSQ or ANN parser based on header annotation type.
 *
 * @param info - Raw INFO key-value pairs from VcfRawRecord
 * @param header - Parsed VCF header with annotation type info
 * @param altAllele - The ALT allele to filter annotations for
 * @param ref - The REF allele (used to disambiguate deletion matching)
 * @returns Annotation result with selected transcript and all transcripts
 */
export function parseAnnotation(
  info: Map<string, string>,
  header: VcfHeader,
  altAllele: string,
  ref?: string
): AnnotationResult {
  if (header.annotationType === 'csq' && header.csqFields !== null) {
    return parseCsq(info, header.csqFields, altAllele, ref ?? '')
  }

  if (header.annotationType === 'ann') {
    return parseAnn(info, altAllele, ref ?? '')
  }

  return emptyResult()
}

// ── CSQ (VEP) Parser ─────────────────────────────────────────

function parseCsq(
  info: Map<string, string>,
  csqFieldNames: string[],
  altAllele: string,
  ref: string
): AnnotationResult {
  const csqRaw = info.get('CSQ')
  if (csqRaw == null || csqRaw === '') return emptyResult()

  const filtered = filterCsqTranscriptsByAllele(
    parseCsqTranscripts(csqRaw, csqFieldNames),
    altAllele,
    ref
  )

  if (filtered.length === 0) return emptyResult()

  // Build TranscriptInsertRows, deduplicating by transcript_id
  // (same transcript can appear multiple times with different consequences)
  const transcriptMap = new Map<string, TranscriptInsertRow>()
  for (const t of filtered) {
    const tid = t.fields.get('Feature') ?? ''
    if (!transcriptMap.has(tid)) {
      transcriptMap.set(tid, {
        transcript_id: tid,
        gene_symbol: t.fields.get('SYMBOL') ?? null,
        consequence: t.fields.get('Consequence') ?? null,
        cdna: t.fields.get('HGVSc') ?? null,
        aa_change: t.fields.get('HGVSp') ?? null,
        hpo_sim_score: null,
        moi: null,
        is_selected: 0
      })
    }
  }
  const transcripts = Array.from(transcriptMap.values())

  // Select best transcript
  const bestIdx = selectBestCsqTranscript(filtered)
  const bestTid = bestIdx >= 0 ? (filtered[bestIdx].fields.get('Feature') ?? '') : ''
  const bestTranscriptRow = transcripts.find((t) => t.transcript_id === bestTid)
  if (bestTranscriptRow) {
    bestTranscriptRow.is_selected = 1
  }

  const best = bestIdx >= 0 ? filtered[bestIdx] : null

  // Parse numeric fields from the best transcript
  const gnomadAfStr = best?.fields.get('gnomADe_AF') ?? best?.fields.get('gnomADg_AF') ?? null
  const caddStr = best?.fields.get('CADD_PHRED') ?? null
  const clinvarStr = best?.fields.get('ClinVar_CLNSIG') ?? null

  return {
    geneSymbol: best?.fields.get('SYMBOL') ?? null,
    consequence: best?.fields.get('Consequence') ?? null,
    impact: best?.fields.get('IMPACT') ?? null,
    transcript: best?.fields.get('Feature') ?? null,
    cdna: best?.fields.get('HGVSc') ?? null,
    aaChange: best?.fields.get('HGVSp') ?? null,
    gnomadAf: gnomadAfStr != null && gnomadAfStr !== '' ? parseFloat(gnomadAfStr) : null,
    cadd: caddStr != null && caddStr !== '' ? parseFloat(caddStr) : null,
    clinvar: clinvarStr ?? null,
    transcripts
  }
}

// ── ANN (SnpEff) Parser ──────────────────────────────────────

// Fixed ANN field indices (SnpEff standard 16-field format)
const ANN_ALLELE = 0
const ANN_ANNOTATION = 1
const ANN_IMPACT = 2
const ANN_GENE_NAME = 3
// const ANN_GENE_ID = 4
// const ANN_FEATURE_TYPE = 5
const ANN_FEATURE_ID = 6
const ANN_BIOTYPE = 7
// const ANN_RANK = 8
const ANN_HGVSC = 9
const ANN_HGVSP = 10
// const ANN_CDNA_POS = 11
// const ANN_CDS_POS = 12
// const ANN_AA_POS = 13
// const ANN_DISTANCE = 14
// const ANN_ERRORS = 15

interface AnnTranscript {
  parts: string[]
  allele: string
}

function parseAnn(info: Map<string, string>, altAllele: string, ref: string): AnnotationResult {
  const annRaw = info.get('ANN')
  if (annRaw == null || annRaw === '') return emptyResult()

  const annotations = annRaw.split(',')
  const parsed: AnnTranscript[] = []

  for (const ann of annotations) {
    if (ann === '') continue
    const parts = ann.split('|')
    const allele = parts[ANN_ALLELE] ?? ''
    parsed.push({ parts, allele })
  }

  // Filter by allele
  const filtered = parsed.filter((t) => matchesAnnotationAllele(t.allele, altAllele, ref))

  if (filtered.length === 0) return emptyResult()

  // Build TranscriptInsertRows, deduplicating by transcript_id
  // (same transcript can appear multiple times with different consequences)
  const transcriptMap = new Map<string, TranscriptInsertRow>()
  for (const t of filtered) {
    const tid = t.parts[ANN_FEATURE_ID] ?? ''
    if (!transcriptMap.has(tid)) {
      transcriptMap.set(tid, {
        transcript_id: tid,
        gene_symbol: t.parts[ANN_GENE_NAME] ?? null,
        consequence: t.parts[ANN_ANNOTATION] ?? null,
        cdna: t.parts[ANN_HGVSC] ?? null,
        aa_change: t.parts[ANN_HGVSP] ?? null,
        hpo_sim_score: null,
        moi: null,
        is_selected: 0
      })
    }
  }
  const transcripts = Array.from(transcriptMap.values())

  // Select best transcript
  const bestIdx = selectBestTranscriptAnn(filtered)
  const bestTid = bestIdx >= 0 ? (filtered[bestIdx].parts[ANN_FEATURE_ID] ?? '') : ''
  const bestTranscriptRow = transcripts.find((t) => t.transcript_id === bestTid)
  if (bestTranscriptRow) {
    bestTranscriptRow.is_selected = 1
  }

  const best = bestIdx >= 0 ? filtered[bestIdx] : null

  return {
    geneSymbol: best?.parts[ANN_GENE_NAME] ?? null,
    consequence: best?.parts[ANN_ANNOTATION] ?? null,
    impact: best?.parts[ANN_IMPACT] ?? null,
    transcript: best?.parts[ANN_FEATURE_ID] ?? null,
    cdna: best?.parts[ANN_HGVSC] ?? null,
    aaChange: best?.parts[ANN_HGVSP] ?? null,
    gnomadAf: null, // ANN doesn't include gnomAD — handled by INFO field registry
    cadd: null, // ANN doesn't include CADD — handled by INFO field registry
    clinvar: null, // ANN doesn't include ClinVar — handled by INFO field registry
    transcripts
  }
}

// ── Shared helpers ───────────────────────────────────────────

/**
 * Select the best ANN transcript using priority:
 * highest IMPACT > protein_coding biotype > first
 */
function selectBestTranscriptAnn(transcripts: AnnTranscript[]): number {
  if (transcripts.length === 0) return -1

  let bestIdx = 0
  let bestScore = -1

  for (let i = 0; i < transcripts.length; i++) {
    const t = transcripts[i]
    let score = 0

    const impact = t.parts[ANN_IMPACT] ?? 'MODIFIER'
    score += (IMPACT_ORDER[impact] ?? 0) * 10

    const biotype = t.parts[ANN_BIOTYPE] ?? ''
    if (biotype === 'protein_coding') score += 5

    if (score > bestScore) {
      bestScore = score
      bestIdx = i
    }
  }

  return bestIdx
}

function emptyResult(): AnnotationResult {
  return {
    geneSymbol: null,
    consequence: null,
    impact: null,
    transcript: null,
    cdna: null,
    aaChange: null,
    gnomadAf: null,
    cadd: null,
    clinvar: null,
    transcripts: []
  }
}
