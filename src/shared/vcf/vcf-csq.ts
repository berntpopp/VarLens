/** Impact severity order for VEP transcript selection. */
const IMPACT_ORDER: Record<string, number> = {
  HIGH: 4,
  MODERATE: 3,
  LOW: 2,
  MODIFIER: 1
}

export interface CsqTranscript {
  fields: Map<string, string>
  allele: string
}

/**
 * Extract VEP CSQ subfield names from a CSQ INFO header line.
 */
export function extractCsqFieldsFromHeaderLine(line: string): string[] | null {
  if (!line.includes('ID=CSQ')) return null
  const match = /Format: ([^"]+)/u.exec(line)
  if (match === null) return null
  return match[1].split('|').map((field) => field.trim())
}

export function parseCsqTranscripts(
  csqValue: string | undefined,
  csqFieldNames: readonly string[]
): CsqTranscript[] {
  if (csqValue === undefined || csqValue === '' || csqFieldNames.length === 0) return []

  const parsed: CsqTranscript[] = []
  for (const annotation of csqValue.split(',')) {
    if (annotation === '') continue

    const values = annotation.split('|')
    const fields = new Map<string, string>()
    csqFieldNames.forEach((field, index) => {
      const value = values[index] ?? ''
      if (value !== '') fields.set(field, value)
    })

    parsed.push({ fields, allele: fields.get('Allele') ?? '' })
  }

  return parsed
}

export function filterCsqTranscriptsByAllele(
  transcripts: readonly CsqTranscript[],
  altAllele: string,
  ref: string
): CsqTranscript[] {
  return transcripts.filter((transcript) =>
    matchesAnnotationAllele(transcript.allele, altAllele, ref)
  )
}

export function selectBestCsqTranscriptForAllele(
  csqValue: string | undefined,
  csqFieldNames: readonly string[],
  altAllele: string,
  ref: string
): CsqTranscript | null {
  const transcripts = filterCsqTranscriptsByAllele(
    parseCsqTranscripts(csqValue, csqFieldNames),
    altAllele,
    ref
  )
  const bestIdx = selectBestCsqTranscript(transcripts)
  return bestIdx >= 0 ? transcripts[bestIdx] : null
}

/**
 * Check if an annotation allele matches the target ALT allele.
 * VEP CSQ uses the VCF ALT bases for SNVs, "-" for deletions, inserted bases for insertions.
 * SnpEff ANN uses the full ALT allele string.
 */
export function matchesAnnotationAllele(
  annotationAllele: string,
  altAllele: string,
  ref: string
): boolean {
  if (annotationAllele === altAllele) return true
  if (annotationAllele === '-' && altAllele.length < ref.length) return true
  if (altAllele.length > 1 && annotationAllele === altAllele.substring(1)) return true
  return false
}

/**
 * Select the best CSQ transcript using priority:
 * MANE Select > Canonical > highest IMPACT > first protein_coding.
 */
export function selectBestCsqTranscript(transcripts: readonly CsqTranscript[]): number {
  if (transcripts.length === 0) return -1

  let bestIdx = 0
  let bestScore = -1

  for (let i = 0; i < transcripts.length; i++) {
    const transcript = transcripts[i]
    let score = 0

    const mane = transcript.fields.get('MANE_SELECT')
    if (mane != null && mane !== '') score += 1000

    const canonical = transcript.fields.get('CANONICAL')
    if (canonical === 'YES') score += 100

    const impact = transcript.fields.get('IMPACT') ?? 'MODIFIER'
    score += (IMPACT_ORDER[impact] ?? 0) * 10

    const biotype = transcript.fields.get('BIOTYPE')
    if (biotype === 'protein_coding') score += 5

    if (score > bestScore) {
      bestScore = score
      bestIdx = i
    }
  }

  return bestIdx
}
