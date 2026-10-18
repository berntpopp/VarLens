/**
 * VCF annotation parser
 *
 * Extracts CSQ (VEP) and ANN (SnpEff) annotations from VCF INFO fields.
 * Selects the "best" transcript and maps to VarLens fields.
 */

import type { VcfHeader, AnnotationResult } from './types'
import { IMPACT_RANK_BY_LEVEL } from '../../../shared/config/severity.config'
import { VEP_CSQ_VALUE_ESCAPES } from '../../../shared/config/vep.config'
import {
  canonicalizeTranscriptSemantics,
  type TranscriptInsertRow
} from '../../../shared/types/transcript'
import { ANN_FIELD_NAMES } from '../../../shared/config/import-fields.config'
import {
  MAX_VCF_ANNOTATION_CHARS,
  MAX_VCF_ANNOTATION_FIELDS,
  MAX_VCF_ANNOTATIONS,
  MAX_VCF_TOTAL_ANNOTATION_VALUES,
  splitBounded,
  VcfResourceLimitError
} from './vcf-resource-limits'
import { csqAlleleSpellings, isVepMinimal, noteAmbiguousCsqSite } from './vcf-csq-allele'

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
      originalAltAlleles,
      isVepMinimal(header)
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
  originalAltAlleles: string[],
  minimal: boolean
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
    const fields = parseCsqEntry(parts, csqFieldNames)

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
    const spellingsOf = (alt: string): Set<string> =>
      csqAlleleSpellings(alt, ref, originalAltAlleles, minimal)
    assertCsqPotentialMatchBudget(parsed, altAlleles, spellingsOf)
    const { targets: targetIndexes, ambiguous } = buildCsqAlleleTargetIndex(
      altAlleles,
      originalAltIndexes,
      originalAltAlleles,
      spellingsOf
    )
    // Only --minimal (per-ALT trimming) is the ambiguity --allele_number resolves.
    if (minimal && parsed.some((t) => ambiguous.has(t.allele))) noteAmbiguousCsqSite()
    for (const transcript of parsed) {
      for (const targetIndex of targetIndexes.get(transcript.allele) ?? []) {
        totalMatches = pushBounded(grouped, targetIndex, transcript, totalMatches, 'CSQ')
      }
    }
  }

  // SV/CNV rows span several genes: a gene they hit beats a MANE one they only flank.
  const impactFirst = info.has('SVTYPE') || originalAltAlleles.some((alt) => alt.startsWith('<'))
  return grouped.map((filtered) => buildCsqResult(filtered, impactFirst))
}

const CSQ_ESCAPE_PATTERN = /%(?:3B|3D|2C|7C|20|25)/gi

/** Undo VEP's CSQ escapes after splitting on `,` and `|`; unknown `%xx` and `&` stay as written. */
function decodeCsqValue(value: string): string {
  if (!value.includes('%')) return value
  return value.replace(CSQ_ESCAPE_PATTERN, (escape) => VEP_CSQ_VALUE_ESCAPES[escape.toUpperCase()])
}

export function parseFiniteFloat(raw: unknown): number | null {
  if (raw == null) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw !== 'string') return null
  if (raw === '' || raw === '.') return null
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) ? n : null
}

export function parseCsqEntry(
  annOrParts: string | string[],
  csqFieldNames: string[]
): Map<string, string> {
  const parts = Array.isArray(annOrParts)
    ? annOrParts
    : splitBounded(annOrParts, '|', MAX_VCF_ANNOTATION_FIELDS)
  if (parts === null) {
    throw new VcfResourceLimitError(
      `CSQ annotation has more than ${MAX_VCF_ANNOTATION_FIELDS} fields`
    )
  }
  const fields = new Map<string, string>()
  for (let i = 0; i < csqFieldNames.length && i < parts.length; i++) {
    const val = parts[i]
    if (val !== '' && val !== '.') {
      fields.set(csqFieldNames[i], decodeCsqValue(val))
    }
  }
  return fields
}

export function extractFromCsq(
  source: Map<string, string> | Record<string, unknown> | CsqTranscript | null | undefined
): {
  gnomadAf: number | null
  cadd: number | null
  clinvar: string | null
  vepClinSig: string | null
} {
  const getField = (key: string): string | null => {
    if (!source) return null
    if ('fields' in source && source.fields instanceof Map) {
      return source.fields.get(key) ?? null
    }
    if (source instanceof Map) {
      return (source as Map<string, string>).get(key) ?? null
    }
    const val = (source as Record<string, unknown>)[key]
    return val != null ? String(val) : null
  }

  const afE = parseFiniteFloat(getField('gnomADe_AF') ?? getField('gnomad_af_exomes'))
  const afG = parseFiniteFloat(getField('gnomADg_AF') ?? getField('gnomad_af_genomes'))
  const afAny = parseFiniteFloat(
    getField('gnomAD_AF') ?? getField('gnomad_af') ?? getField('MAX_AF')
  )
  const gnomadAf = afE ?? afG ?? afAny ?? null
  const cadd = parseFiniteFloat(getField('CADD_PHRED') ?? getField('cadd'))
  const clinvar = getField('ClinVar_CLNSIG') ?? getField('clinvar') ?? null
  const vepClinSig = getField('CLIN_SIG') ?? null

  return {
    gnomadAf,
    cadd,
    clinvar,
    vepClinSig
  }
}

function buildCsqResult(filtered: CsqTranscript[], impactFirst: boolean): AnnotationResult {
  if (filtered.length === 0) return emptyResult()

  const transcriptMap = new Map<string, CsqTranscript>()
  for (const t of filtered) {
    const tid = t.fields.get('Feature') ?? ''
    const existing = transcriptMap.get(tid)
    if (existing === undefined || selectBestTranscript([existing, t], impactFirst) === 1) {
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

  const bestIdx = selectBestTranscript(filtered, impactFirst)
  const bestTid = bestIdx >= 0 ? (filtered[bestIdx].fields.get('Feature') ?? '') : ''
  const bestTranscriptRow = transcripts.find((t) => t.transcript_id === bestTid)
  if (bestTranscriptRow) bestTranscriptRow.is_selected = 1

  const best = bestIdx >= 0 ? filtered[bestIdx] : null
  const bestSemantics = canonicalizeTranscriptSemantics(
    best?.fields.get('IMPACT') ?? null,
    best?.fields.get('Consequence') ?? null
  )

  const extracted = extractFromCsq(best)

  return {
    geneSymbol: best?.fields.get('SYMBOL') ?? null,
    consequence: best?.fields.get('Consequence') ?? null,
    impact: bestSemantics.consequence,
    transcript: best?.fields.get('Feature') ?? null,
    cdna: best?.fields.get('HGVSc') ?? null,
    aaChange: best?.fields.get('HGVSp') ?? null,
    gnomadAf: extracted.gnomadAf,
    cadd: extracted.cadd,
    clinvar: extracted.clinvar,
    vepClinSig: extracted.vepClinSig,
    selectedFields: best?.fields,
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
    selectedFields: best === null ? undefined : annFields(best.parts),
    transcripts
  }
}

function annFields(parts: string[]): Map<string, string> {
  const fields = new Map<string, string>()
  parts.forEach((part, i) => {
    if (part !== '' && i < ANN_FIELD_NAMES.length) fields.set(ANN_FIELD_NAMES[i], part)
  })
  return fields
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
  spellingsOf: (alt: string) => Set<string>
): { targets: Map<string, number[]>; ambiguous: Set<string> } {
  // A spelling two ALTs share is ambiguous: neither gets it (fail closed).
  const spellingCounts = new Map<string, number>()
  for (const originalAlt of originalAltAlleles) {
    for (const spelling of spellingsOf(originalAlt)) {
      spellingCounts.set(spelling, (spellingCounts.get(spelling) ?? 0) + 1)
    }
  }

  const targets = new Map<string, number[]>()
  for (let targetIndex = 0; targetIndex < altAlleles.length; targetIndex += 1) {
    const originalAlt = originalAltAlleles[originalAltIndexes[targetIndex]]
    if (originalAlt === undefined) continue
    for (const spelling of spellingsOf(originalAlt)) {
      if (spellingCounts.get(spelling) === 1) addTarget(targets, spelling, targetIndex)
    }
  }
  const ambiguous = new Set([...spellingCounts].filter(([, n]) => n > 1).map(([s]) => s))
  return { targets, ambiguous }
}

function assertCsqPotentialMatchBudget(
  transcripts: CsqTranscript[],
  altAlleles: string[],
  spellingsOf: (alt: string) => Set<string>
): void {
  const potentialTargets = new Map<string, number>()
  for (const alt of altAlleles) {
    for (const spelling of spellingsOf(alt)) {
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
 * MANE Select > Canonical > highest IMPACT > first protein_coding,
 * or highest IMPACT > named gene > MANE ... when `impactFirst` (SV/CNV rows).
 */
function selectBestTranscript(transcripts: CsqTranscript[], impactFirst: boolean): number {
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
    score += (IMPACT_RANK_BY_LEVEL[impact] ?? 0) * (impactFirst ? 10_000 : 10)
    // VEP leaves SYMBOL empty on unnamed transcripts; an SV/CNV row needs a gene.
    if (impactFirst && (t.fields.get('SYMBOL') ?? '') !== '') score += 5_000

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
    score += (IMPACT_RANK_BY_LEVEL[impact] ?? 0) * 10

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
