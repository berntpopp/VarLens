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
 * @param alleleIndex - 1-based index of altAllele among the original ALT list
 *   (matches VEP CSQ's ALLELE_NUM). Required to disambiguate multi-allelic
 *   deletion sites, where VEP emits "-" for every deletion ALT.
 * @param originalAltAlleles - All ALT alleles before splitting. Used to reject
 *   lossy annotation allele heuristics that match more than one ALT.
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
  if (
    header.annotationType === 'csq' &&
    header.csqFields !== null &&
    header.csqFields.includes('ALLELE_NUM') &&
    alleleIndex === undefined
  ) {
    return emptyResult()
  }
  const originalAltIndexes = alleleIndex === undefined ? undefined : [alleleIndex - 1]
  return (
    parseAnnotationsForAlleles(
      info,
      header,
      [altAllele],
      ref ?? '',
      originalAltIndexes,
      originalAltAlleles
    )[0] ?? emptyResult()
  )
}

/**
 * Parse one annotation payload once and partition its transcripts across all
 * requested ALT alleles. This keeps allocation proportional to the annotation
 * payload plus matched transcripts instead of reparsing/rebuilding it for
 * every ALT.
 */
export function parseAnnotationsForAlleles(
  info: Map<string, string>,
  header: VcfHeader,
  altAlleles: string[],
  ref = '',
  originalAltIndexes: number[] = altAlleles.map((_, index) => index),
  originalAltAlleles: string[] = altAlleles
): AnnotationResult[] {
  if (header.annotationType === 'csq' && header.csqFields !== null) {
    return parseCsqForAlleles(
      info,
      header.csqFields,
      altAlleles,
      ref,
      originalAltIndexes,
      originalAltAlleles
    )
  }

  if (header.annotationType === 'ann') {
    return parseAnnForAlleles(info, altAlleles, originalAltAlleles)
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
  ref: string,
  originalAltIndexes: number[],
  originalAltAlleles: string[]
): AnnotationResult[] {
  const csqRaw = info.get('CSQ')
  if (csqRaw == null || csqRaw === '') return altAlleles.map(() => emptyResult())
  if (csqRaw.length > MAX_VCF_ANNOTATION_CHARS) {
    throw new VcfResourceLimitError(`CSQ annotation exceeds ${MAX_VCF_ANNOTATION_CHARS} characters`)
  }

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
      if (parts[i] !== '') fields.set(csqFieldNames[i], parts[i])
    }

    parsed.push({ fields, allele: fields.get('Allele') ?? '' })
  }

  const grouped = altAlleles.map(() => [] as CsqTranscript[])
  let totalMatches = 0

  if (csqFieldNames.includes('ALLELE_NUM')) {
    const targetByAlleleNum = new Map<number, number>()
    for (let targetIndex = 0; targetIndex < originalAltIndexes.length; targetIndex += 1) {
      targetByAlleleNum.set(originalAltIndexes[targetIndex] + 1, targetIndex)
    }

    for (const transcript of parsed) {
      const alleleNumStr = transcript.fields.get('ALLELE_NUM')
      if (alleleNumStr === undefined || !/^[1-9]\d*$/.test(alleleNumStr)) continue
      const alleleNum = Number(alleleNumStr)
      if (!Number.isSafeInteger(alleleNum)) continue
      const targetIndex = targetByAlleleNum.get(alleleNum)
      if (targetIndex === undefined) continue
      totalMatches = pushBounded(grouped, targetIndex, transcript, totalMatches, 'CSQ')
    }
  } else {
    assertCsqPotentialMatchBudget(parsed, altAlleles, ref)
    const targetIndexes = buildCsqAlleleTargetIndex(
      altAlleles,
      originalAltIndexes,
      originalAltAlleles,
      ref
    )
    for (const transcript of parsed) {
      for (const targetIndex of targetIndexes.get(transcript.allele) ?? []) {
        totalMatches = pushBounded(grouped, targetIndex, transcript, totalMatches, 'CSQ')
      }
    }
  }

  return grouped.map(buildCsqResult)
}

function buildCsqResult(filtered: CsqTranscript[]): AnnotationResult {
  if (filtered.length === 0) return emptyResult()

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

  const bestIdx = selectBestTranscript(filtered)
  const bestTid = bestIdx >= 0 ? (filtered[bestIdx].fields.get('Feature') ?? '') : ''
  const bestTranscriptRow = transcripts.find((t) => t.transcript_id === bestTid)
  if (bestTranscriptRow) bestTranscriptRow.is_selected = 1

  const best = bestIdx >= 0 ? filtered[bestIdx] : null
  const bestSemantics = canonicalizeTranscriptSemantics(
    best?.fields.get('IMPACT') ?? null,
    best?.fields.get('Consequence') ?? null
  )

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

const ANN_ALLELE = 0
const ANN_ANNOTATION = 1
const ANN_IMPACT = 2
const ANN_GENE_NAME = 3
const ANN_FEATURE_ID = 6
const ANN_BIOTYPE = 7
const ANN_HGVSC = 9
const ANN_HGVSP = 10

interface AnnTranscript {
  parts: string[]
  allele: string
}

function parseAnnForAlleles(
  info: Map<string, string>,
  altAlleles: string[],
  originalAltAlleles: string[]
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
    parsed.push({ parts, allele: parts[ANN_ALLELE] ?? '' })
  }

  const grouped = altAlleles.map(() => [] as AnnTranscript[])
  const targetIndexes = buildAnnAlleleTargetIndex(altAlleles, originalAltAlleles)
  let totalMatches = 0

  for (const transcript of parsed) {
    const leadingAlt = transcript.allele.split('-', 1)[0]
    for (const targetIndex of targetIndexes.get(leadingAlt) ?? []) {
      totalMatches = pushBounded(grouped, targetIndex, transcript, totalMatches, 'ANN')
    }
  }

  return grouped.map(buildAnnResult)
}

function buildAnnResult(filtered: AnnTranscript[]): AnnotationResult {
  if (filtered.length === 0) return emptyResult()

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

  const bestIdx = selectBestTranscriptAnn(filtered)
  const bestTid = bestIdx >= 0 ? (filtered[bestIdx].parts[ANN_FEATURE_ID] ?? '') : ''
  const bestTranscriptRow = transcripts.find((t) => t.transcript_id === bestTid)
  if (bestTranscriptRow) bestTranscriptRow.is_selected = 1

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
    gnomadAf: null,
    cadd: null,
    clinvar: null,
    transcripts
  }
}

// ── Shared helpers ───────────────────────────────────────────

function pushBounded<T>(
  grouped: T[][],
  targetIndex: number,
  transcript: T,
  totalMatches: number,
  annotationType: 'CSQ' | 'ANN'
): number {
  const nextTotal = totalMatches + 1
  if (nextTotal > MAX_VCF_TOTAL_ANNOTATION_MATCHES) {
    throw new VcfResourceLimitError(
      `${annotationType} annotation matches exceed ${MAX_VCF_TOTAL_ANNOTATION_MATCHES}`
    )
  }
  grouped[targetIndex].push(transcript)
  return nextTotal
}

function buildCsqAlleleTargetIndex(
  altAlleles: string[],
  originalAltIndexes: number[],
  originalAltAlleles: string[],
  ref: string
): Map<string, number[]> {
  const spellingCounts = new Map<string, number>()
  for (const originalAlt of originalAltAlleles) {
    for (const spelling of csqAlleleSpellings(originalAlt, ref)) {
      spellingCounts.set(spelling, (spellingCounts.get(spelling) ?? 0) + 1)
    }
  }

  const targets = new Map<string, number[]>()
  for (let targetIndex = 0; targetIndex < altAlleles.length; targetIndex += 1) {
    const originalAlt = originalAltAlleles[originalAltIndexes[targetIndex]]
    if (originalAlt === undefined) continue
    for (const spelling of csqAlleleSpellings(originalAlt, ref)) {
      if (spellingCounts.get(spelling) === 1) addTarget(targets, spelling, targetIndex)
    }
  }
  return targets
}

function assertCsqPotentialMatchBudget(
  transcripts: CsqTranscript[],
  altAlleles: string[],
  ref: string
): void {
  const potentialTargets = new Map<string, number>()
  for (const alt of altAlleles) {
    for (const spelling of csqAlleleSpellings(alt, ref)) {
      potentialTargets.set(spelling, (potentialTargets.get(spelling) ?? 0) + 1)
    }
  }

  let totalMatches = 0
  for (const transcript of transcripts) {
    totalMatches += potentialTargets.get(transcript.allele) ?? 0
    if (totalMatches > MAX_VCF_TOTAL_ANNOTATION_MATCHES) {
      throw new VcfResourceLimitError(
        `CSQ annotation matches exceed ${MAX_VCF_TOTAL_ANNOTATION_MATCHES}`
      )
    }
  }
}

function csqAlleleSpellings(altAllele: string, ref: string): Set<string> {
  const spellings = new Set<string>([altAllele])
  if (altAllele.length < ref.length) spellings.add('-')
  if (altAllele.length > 1) spellings.add(altAllele.substring(1))
  return spellings
}

function buildAnnAlleleTargetIndex(
  altAlleles: string[],
  originalAltAlleles: string[]
): Map<string, number[]> {
  const exactCounts = new Map<string, number>()
  for (const originalAlt of originalAltAlleles) {
    exactCounts.set(originalAlt, (exactCounts.get(originalAlt) ?? 0) + 1)
  }

  const targets = new Map<string, number[]>()
  for (let targetIndex = 0; targetIndex < altAlleles.length; targetIndex += 1) {
    const alt = altAlleles[targetIndex]
    if (exactCounts.get(alt) === 1) addTarget(targets, alt, targetIndex)
  }
  return targets
}

function addTarget(targets: Map<string, number[]>, allele: string, targetIndex: number): void {
  const existing = targets.get(allele)
  if (existing === undefined) {
    targets.set(allele, [targetIndex])
    return
  }
  if (existing[existing.length - 1] !== targetIndex) existing.push(targetIndex)
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

    const mane = t.fields.get('MANE_SELECT')
    if (mane != null && mane !== '') score += 1000

    const canonical = t.fields.get('CANONICAL')
    if (canonical === 'YES') score += 100

    const impact = t.fields.get('IMPACT') ?? 'MODIFIER'
    score += (IMPACT_ORDER[impact] ?? 0) * 10

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
