/**
 * VCF annotation parser
 *
 * Extracts CSQ (VEP) and ANN (SnpEff) annotations from VCF INFO fields.
 * Selects the "best" transcript and maps to VarLens fields.
 */

import type { VcfHeader, AnnotationResult } from './types'
import {
  canonicalizeTranscriptSemantics,
  type TranscriptInsertRow
} from '../../../shared/types/transcript'

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
 * @param alleleIndex - 1-based index of altAllele among the original ALT list
 *   (matches VEP CSQ's ALLELE_NUM). Required to disambiguate multi-allelic
 *   deletion sites, where VEP emits "-" for every deletion ALT.
 * @param originalAltAlleles - All ALT alleles before splitting. Used to reject
 *   lossy CSQ allele heuristics that match more than one ALT.
 * @returns Annotation result with selected transcript and all transcripts
 */
export function parseAnnotation(
  info: Map<string, string>,
  header: VcfHeader,
  altAllele: string,
  ref?: string,
  alleleIndex?: number,
  originalAltAlleles: string[] = [altAllele]
): AnnotationResult {
  if (header.annotationType === 'csq' && header.csqFields !== null) {
    return parseCsq(info, header.csqFields, altAllele, ref ?? '', alleleIndex, originalAltAlleles)
  }

  if (header.annotationType === 'ann') {
    return parseAnn(info, altAllele, ref ?? '')
  }

  return emptyResult()
}

// ── CSQ (VEP) Parser ─────────────────────────────────────────

interface CsqTranscript {
  fields: Map<string, string>
  allele: string
}

function parseCsq(
  info: Map<string, string>,
  csqFieldNames: string[],
  altAllele: string,
  ref: string,
  alleleIndex: number | undefined,
  originalAltAlleles: string[]
): AnnotationResult {
  const csqRaw = info.get('CSQ')
  if (csqRaw == null || csqRaw === '') return emptyResult()

  // Split annotations by comma, then each by pipe
  const annotations = csqRaw.split(',')
  const parsed: CsqTranscript[] = []

  for (const ann of annotations) {
    if (ann === '') continue
    const parts = ann.split('|')
    const fields = new Map<string, string>()

    for (let i = 0; i < csqFieldNames.length && i < parts.length; i++) {
      if (parts[i] !== '') {
        fields.set(csqFieldNames[i], parts[i])
      }
    }

    const allele = fields.get('Allele') ?? ''
    parsed.push({ fields, allele })
  }

  // Filter by allele. VEP's Allele field is "-" for every deletion ALT at a site,
  // so at a multi-deletion multi-allelic site the Allele/length heuristic alone
  // cannot tell two deletions apart. When the CSQ config declares ALLELE_NUM
  // (the 1-based index of the ALT this block annotates), prefer it — it is the
  // only reliable discriminator for that case. Fall back to Allele-string
  // heuristics only when ALLELE_NUM is absent from the header entirely. Once
  // declared, a block with a missing or malformed value is unsafe to attach:
  // partial fallback can cross-match another ALT at a mixed multi-allelic site.
  const hasAlleleNumField = csqFieldNames.includes('ALLELE_NUM')
  const filtered = parsed.filter((t) => {
    if (hasAlleleNumField) {
      if (alleleIndex === undefined) return false
      const alleleNumStr = t.fields.get('ALLELE_NUM')
      if (alleleNumStr === undefined || !/^[1-9]\d*$/.test(alleleNumStr)) return false
      const parsedAlleleNum = Number(alleleNumStr)
      return Number.isSafeInteger(parsedAlleleNum) && parsedAlleleNum === alleleIndex
    }
    if (!matchesAllele(t.allele, altAllele, ref)) return false
    const matchingAltCount = originalAltAlleles.filter((candidate) =>
      matchesAllele(t.allele, candidate, ref)
    ).length
    return matchingAltCount === 1
  })

  if (filtered.length === 0) return emptyResult()

  // Build TranscriptInsertRows, deduplicating by transcript_id
  // (same transcript can appear multiple times with different consequences)
  const transcriptMap = new Map<string, CsqTranscript>()
  for (const t of filtered) {
    const tid = t.fields.get('Feature') ?? ''
    const existing = transcriptMap.get(tid)
    if (existing === undefined || selectBestTranscript([existing, t]) === 1) {
      transcriptMap.set(tid, t)
    }
  }
  const transcripts: TranscriptInsertRow[] = Array.from(transcriptMap.values()).map((t) => {
    const semantics = canonicalizeTranscriptSemantics(
      t.fields.get('IMPACT') ?? null,
      t.fields.get('Consequence') ?? null
    )
    return {
      transcript_id: t.fields.get('Feature') ?? '',
      gene_symbol: t.fields.get('SYMBOL') ?? null,
      // Canonical model: consequence = IMPACT level, func = SO term.
      consequence: semantics.consequence,
      func: semantics.func,
      cdna: t.fields.get('HGVSc') ?? null,
      aa_change: t.fields.get('HGVSp') ?? null,
      hpo_sim_score: null,
      moi: null,
      is_selected: 0
    }
  })

  // Select best transcript
  const bestIdx = selectBestTranscript(filtered)
  const bestTid = bestIdx >= 0 ? (filtered[bestIdx].fields.get('Feature') ?? '') : ''
  const bestTranscriptRow = transcripts.find((t) => t.transcript_id === bestTid)
  if (bestTranscriptRow) {
    bestTranscriptRow.is_selected = 1
  }

  const best = bestIdx >= 0 ? filtered[bestIdx] : null
  const bestSemantics = canonicalizeTranscriptSemantics(
    best?.fields.get('IMPACT') ?? null,
    best?.fields.get('Consequence') ?? null
  )

  // Parse numeric fields from the best transcript
  const gnomadAfStr = best?.fields.get('gnomADe_AF') ?? best?.fields.get('gnomADg_AF') ?? null
  const caddStr = best?.fields.get('CADD_PHRED') ?? null
  const clinvarStr = best?.fields.get('ClinVar_CLNSIG') ?? null

  return {
    geneSymbol: best?.fields.get('SYMBOL') ?? null,
    consequence: best?.fields.get('Consequence') ?? null,
    impact: bestSemantics.consequence,
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

  // Filter by allele. Unlike VEP CSQ, SnpEff's ANN field 0 is always the literal
  // raw VCF ALT string — confirmed against real SnpEff output in
  // tests/test-data/vcf/edge-cases.snpeff.vcf.gz and single-sample.snpeff.vcf.gz,
  // e.g. REF=C ALT=CT,CTT emits ANN=CT|...,CTT|... and REF=T ALT=TTATC emits
  // ANN=TTATC|..., never a VEP-style "inserted bases only" suffix. So ANN alleles
  // disambiguate by exact sequence match only. Both VEP heuristics in
  // matchesAllele must be disabled here:
  //   - the "-" deletion shortcut (allowDeletionDash) — SnpEff never emits "-",
  //     so a literal "-" block must not cross-match a shorter ALT.
  //   - the insertion-suffix heuristic (allowInsertionSuffix), i.e.
  //     `annAllele === altAllele.substring(1)` — this exists only to match VEP's
  //     "inserted bases only" notation. Left enabled for ANN, it lets a block
  //     for one split ALT cross-attach to an unrelated, longer split ALT that
  //     happens to share a suffix (e.g. REF=A ALT=AT,T: the T block's allele
  //     "T" equals "AT".substring(1), wrongly attaching it to the AT split).
  const filtered = parsed.filter((t) => matchesAllele(t.allele, altAllele, ref, false, false))

  if (filtered.length === 0) return emptyResult()

  // Build TranscriptInsertRows, deduplicating by transcript_id
  // (same transcript can appear multiple times with different consequences)
  const transcriptMap = new Map<string, AnnTranscript>()
  for (const t of filtered) {
    const tid = t.parts[ANN_FEATURE_ID] ?? ''
    const existing = transcriptMap.get(tid)
    if (existing === undefined || selectBestTranscriptAnn([existing, t]) === 1) {
      transcriptMap.set(tid, t)
    }
  }
  const transcripts: TranscriptInsertRow[] = Array.from(transcriptMap.values()).map((t) => {
    const semantics = canonicalizeTranscriptSemantics(
      t.parts[ANN_IMPACT] ?? null,
      t.parts[ANN_ANNOTATION] ?? null
    )
    return {
      transcript_id: t.parts[ANN_FEATURE_ID] ?? '',
      gene_symbol: t.parts[ANN_GENE_NAME] ?? null,
      // Canonical model: consequence = IMPACT level, func = SO term.
      consequence: semantics.consequence,
      func: semantics.func,
      cdna: t.parts[ANN_HGVSC] ?? null,
      aa_change: t.parts[ANN_HGVSP] ?? null,
      hpo_sim_score: null,
      moi: null,
      is_selected: 0
    }
  })

  // Select best transcript
  const bestIdx = selectBestTranscriptAnn(filtered)
  const bestTid = bestIdx >= 0 ? (filtered[bestIdx].parts[ANN_FEATURE_ID] ?? '') : ''
  const bestTranscriptRow = transcripts.find((t) => t.transcript_id === bestTid)
  if (bestTranscriptRow) {
    bestTranscriptRow.is_selected = 1
  }

  const best = bestIdx >= 0 ? filtered[bestIdx] : null
  const bestSemantics = canonicalizeTranscriptSemantics(
    best?.parts[ANN_IMPACT] ?? null,
    best?.parts[ANN_ANNOTATION] ?? null
  )

  return {
    geneSymbol: best?.parts[ANN_GENE_NAME] ?? null,
    consequence: best?.parts[ANN_ANNOTATION] ?? null,
    impact: bestSemantics.consequence,
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
 * Check if an annotation allele matches the target ALT allele.
 * VEP CSQ uses the VCF ALT bases for SNVs, "-" for deletions, inserted bases for insertions.
 * SnpEff ANN uses the full raw ALT allele string exactly as written in the VCF ALT
 * column (real sequence, never "-", never an inserted-bases-only suffix).
 *
 * @param allowDeletionDash - Whether the VEP "-" deletion shortcut may fire. VEP's
 *   Allele field is lossy ("-" for every deletion ALT at a multi-allelic site), so
 *   this is only a safe heuristic for VEP CSQ, and only as a fallback when
 *   ALLELE_NUM disambiguation isn't available. SnpEff ANN callers must pass
 *   `false` — ANN's allele field is always a concrete sequence, so a literal "-"
 *   there is never a real allele and must not cross-match a shorter ALT.
 * @param allowInsertionSuffix - Whether the VEP "inserted bases only" heuristic
 *   (`annAllele === altAllele.substring(1)`) may fire. VEP's Allele field for an
 *   insertion is the inserted bases only (ALT minus the shared first base), so
 *   this is a safe heuristic only for VEP CSQ. SnpEff ANN callers must pass
 *   `false` — ANN's allele field is always the full raw ALT string, so this
 *   substring heuristic is not just unnecessary but actively wrong: at a mixed
 *   multi-allelic site (e.g. REF=A ALT=AT,T) it makes the shorter split's ANN
 *   block ("T") falsely match the longer split's ALT ("AT"), since
 *   "AT".substring(1) === "T".
 */
function matchesAllele(
  annAllele: string,
  altAllele: string,
  ref: string,
  allowDeletionDash: boolean = true,
  allowInsertionSuffix: boolean = true
): boolean {
  if (annAllele === altAllele) return true
  // VEP deletion notation: "-" only matches when ALT is actually shorter than REF
  if (allowDeletionDash && annAllele === '-' && altAllele.length < ref.length) return true
  // VEP insertion: the annotation Allele is the inserted bases (ALT minus first base)
  if (allowInsertionSuffix && altAllele.length > 1 && annAllele === altAllele.substring(1)) {
    return true
  }
  return false
}

/**
 * Select the best CSQ transcript using priority:
 * MANE Select > Canonical > highest IMPACT > first protein_coding
 */
function selectBestTranscript(transcripts: CsqTranscript[]): number {
  if (transcripts.length === 0) return -1

  let bestIdx = 0
  let bestScore = -1

  for (let i = 0; i < transcripts.length; i++) {
    const t = transcripts[i]
    let score = 0

    // MANE_SELECT presence: highest priority
    const mane = t.fields.get('MANE_SELECT')
    if (mane != null && mane !== '') score += 1000

    // CANONICAL=YES
    const canonical = t.fields.get('CANONICAL')
    if (canonical === 'YES') score += 100

    // Impact severity
    const impact = t.fields.get('IMPACT') ?? 'MODIFIER'
    score += (IMPACT_ORDER[impact] ?? 0) * 10

    // protein_coding biotype preference
    const biotype = t.fields.get('BIOTYPE')
    if (biotype === 'protein_coding') score += 5

    if (score > bestScore) {
      bestScore = score
      bestIdx = i
    }
  }

  return bestIdx
}

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
