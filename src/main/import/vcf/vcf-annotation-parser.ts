/**
 * VCF annotation parser
 *
 * Extracts CSQ (VEP) and ANN (SnpEff) annotations from VCF INFO fields.
 * Selects the "best" transcript and maps to VarLens fields.
 */

import type { VcfHeader, AnnotationResult } from './types'
import type { TranscriptInsertRow } from '../../../shared/types/transcript'
import {
  MAX_VCF_ANNOTATION_CHARS,
  MAX_VCF_ANNOTATION_FIELDS,
  MAX_VCF_ANNOTATIONS,
  MAX_VCF_TOTAL_ANNOTATION_VALUES,
  splitBounded,
  VcfResourceLimitError
} from './vcf-resource-limits'

/** Impact severity order for transcript selection */
const IMPACT_ORDER: Record<string, number> = {
  HIGH: 4,
  MODERATE: 3,
  LOW: 2,
  MODIFIER: 1
}
const MAX_VCF_TOTAL_ANNOTATION_MATCHES = 100_000

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
  return parseAnnotationsForAlleles(info, header, [altAllele], ref)[0] ?? emptyResult()
}

/**
 * Parse one annotation payload once and partition its transcripts across all
 * ALT alleles. This keeps allocation proportional to the annotation payload
 * plus matched transcripts instead of reparsing/rebuilding it for every ALT.
 */
export function parseAnnotationsForAlleles(
  info: Map<string, string>,
  header: VcfHeader,
  altAlleles: string[],
  ref = ''
): AnnotationResult[] {
  if (header.annotationType === 'csq' && header.csqFields !== null) {
    return parseCsqForAlleles(info, header.csqFields, altAlleles, ref)
  }

  if (header.annotationType === 'ann') {
    return parseAnnForAlleles(info, altAlleles, ref)
  }

  return altAlleles.map(() => emptyResult())
}

// ── CSQ (VEP) Parser ─────────────────────────────────────────

interface CsqTranscript {
  fields: Map<string, string>
  allele: string
}

function parseCsqForAlleles(
  info: Map<string, string>,
  csqFieldNames: string[],
  altAlleles: string[],
  ref: string
): AnnotationResult[] {
  const csqRaw = info.get('CSQ')
  if (csqRaw == null || csqRaw === '') return altAlleles.map(() => emptyResult())
  if (csqRaw.length > MAX_VCF_ANNOTATION_CHARS) {
    throw new VcfResourceLimitError(`CSQ annotation exceeds ${MAX_VCF_ANNOTATION_CHARS} characters`)
  }

  // Split annotations by comma, then each by pipe
  const annotations = splitBounded(csqRaw, ',', MAX_VCF_ANNOTATIONS)
  if (annotations === null) {
    throw new VcfResourceLimitError(`CSQ has more than ${MAX_VCF_ANNOTATIONS} annotations`)
  }
  const parsed: CsqTranscript[] = []
  let totalValues = 0

  for (const ann of annotations) {
    if (ann === '') continue
    const parts = splitBounded(ann, '|', MAX_VCF_ANNOTATION_FIELDS)
    if (parts === null) {
      throw new VcfResourceLimitError(
        `CSQ annotation has more than ${MAX_VCF_ANNOTATION_FIELDS} fields`
      )
    }
    totalValues += parts.length
    if (totalValues > MAX_VCF_TOTAL_ANNOTATION_VALUES) {
      throw new VcfResourceLimitError(
        `CSQ has more than ${MAX_VCF_TOTAL_ANNOTATION_VALUES} total values`
      )
    }
    const fields = new Map<string, string>()

    for (let i = 0; i < csqFieldNames.length && i < parts.length; i++) {
      if (parts[i] !== '') {
        fields.set(csqFieldNames[i], parts[i])
      }
    }

    const allele = fields.get('Allele') ?? ''
    parsed.push({ fields, allele })
  }

  // VEP uses the ALT base for SNVs, "-" for deletions, and inserted sequence
  // for insertions. Partition the already-parsed transcript objects once.
  const grouped = altAlleles.map(() => [] as CsqTranscript[])
  const targetIndexes = buildAlleleTargetIndex(altAlleles, ref)
  let totalMatches = 0
  for (const transcript of parsed) {
    for (const index of targetIndexes.get(transcript.allele) ?? []) {
      totalMatches += 1
      if (totalMatches > MAX_VCF_TOTAL_ANNOTATION_MATCHES) {
        throw new VcfResourceLimitError(
          `CSQ annotation matches exceed ${MAX_VCF_TOTAL_ANNOTATION_MATCHES}`
        )
      }
      grouped[index].push(transcript)
    }
  }
  return grouped.map(buildCsqResult)
}

function buildCsqResult(filtered: CsqTranscript[]): AnnotationResult {
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
  const bestIdx = selectBestTranscript(filtered)
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

function parseAnnForAlleles(
  info: Map<string, string>,
  altAlleles: string[],
  ref: string
): AnnotationResult[] {
  const annRaw = info.get('ANN')
  if (annRaw == null || annRaw === '') return altAlleles.map(() => emptyResult())
  if (annRaw.length > MAX_VCF_ANNOTATION_CHARS) {
    throw new VcfResourceLimitError(`ANN annotation exceeds ${MAX_VCF_ANNOTATION_CHARS} characters`)
  }

  const annotations = splitBounded(annRaw, ',', MAX_VCF_ANNOTATIONS)
  if (annotations === null) {
    throw new VcfResourceLimitError(`ANN has more than ${MAX_VCF_ANNOTATIONS} annotations`)
  }
  const parsed: AnnTranscript[] = []
  let totalValues = 0

  for (const ann of annotations) {
    if (ann === '') continue
    const parts = splitBounded(ann, '|', MAX_VCF_ANNOTATION_FIELDS)
    if (parts === null) {
      throw new VcfResourceLimitError(
        `ANN annotation has more than ${MAX_VCF_ANNOTATION_FIELDS} fields`
      )
    }
    totalValues += parts.length
    if (totalValues > MAX_VCF_TOTAL_ANNOTATION_VALUES) {
      throw new VcfResourceLimitError(
        `ANN has more than ${MAX_VCF_TOTAL_ANNOTATION_VALUES} total values`
      )
    }
    const allele = parts[ANN_ALLELE] ?? ''
    parsed.push({ parts, allele })
  }

  const grouped = altAlleles.map(() => [] as AnnTranscript[])
  const targetIndexes = buildAlleleTargetIndex(altAlleles, ref)
  let totalMatches = 0
  for (const transcript of parsed) {
    for (const index of targetIndexes.get(transcript.allele) ?? []) {
      totalMatches += 1
      if (totalMatches > MAX_VCF_TOTAL_ANNOTATION_MATCHES) {
        throw new VcfResourceLimitError(
          `ANN annotation matches exceed ${MAX_VCF_TOTAL_ANNOTATION_MATCHES}`
        )
      }
      grouped[index].push(transcript)
    }
  }
  return grouped.map(buildAnnResult)
}

function buildAnnResult(filtered: AnnTranscript[]): AnnotationResult {
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

/** Build every accepted annotation spelling once for O(ALT + annotation) grouping. */
function buildAlleleTargetIndex(altAlleles: string[], ref: string): Map<string, number[]> {
  const targets = new Map<string, number[]>()
  const add = (allele: string, index: number): void => {
    const existing = targets.get(allele)
    if (existing === undefined) targets.set(allele, [index])
    else if (existing[existing.length - 1] !== index) existing.push(index)
  }

  for (let index = 0; index < altAlleles.length; index += 1) {
    const alt = altAlleles[index]
    add(alt, index)
    if (alt.length < ref.length) add('-', index)
    if (alt.length > 1) add(alt.substring(1), index)
  }
  return targets
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
