/**
 * Allele normalisation (#587):
 * - `trimAlleles`: strip common suffix, then common prefix, keeping one anchor base.
 * - `leftAlignAlleles`: Tan et al. (2015) reference-aware repeat-shift left-alignment
 *   plus prefix/suffix trimming when an indexed reference window lookup is supplied,
 *   falling back to `trimAlleles` when no reference window is available.
 */
export interface TrimmedAlleles {
  pos: number
  ref: string
  alt: string
}

/**
 * Returns the upper-case reference bases for `[start1Based, end1BasedInclusive]`,
 * or `null` if the contig/interval is unavailable.
 */
export type ReferenceWindowLookup = (
  start1Based: number,
  end1BasedInclusive: number
) => string | null

/** Symbolic (`<DEL>`), breakend (`A[chr2:1[`), spanning (`*`) or missing (`.`) ALT. */
function isSymbolic(allele: string): boolean {
  return (
    allele === '*' ||
    allele === '.' ||
    allele.startsWith('<') ||
    allele.includes('[') ||
    allele.includes(']')
  )
}

export function trimAlleles(pos: number, ref: string, alt: string): TrimmedAlleles {
  if (isSymbolic(alt) || isSymbolic(ref)) return { pos, ref, alt }
  let end = 0
  while (
    ref.length - end > 1 &&
    alt.length - end > 1 &&
    ref[ref.length - 1 - end] === alt[alt.length - 1 - end]
  ) {
    end++
  }
  let start = 0
  while (
    ref.length - end - start > 1 &&
    alt.length - end - start > 1 &&
    ref[start] === alt[start]
  ) {
    start++
  }
  if (start === 0 && end === 0) return { pos, ref, alt }
  return {
    pos: pos + start,
    ref: ref.slice(start, ref.length - end),
    alt: alt.slice(start, alt.length - end)
  }
}

/**
 * Tan et al. (2015) unified variant normalization (`leftAlignAlleles`):
 * 1. While the last base of `ref` and `alt` match, strip the last base; if
 *    either allele becomes empty and `pos > 1`, prepend the preceding reference
 *    base (`pos - 1`) to both alleles and continue shifting left.
 * 2. Trim any common prefix while keeping at least 1 base in both `ref` and `alt`.
 *
 * Falls back to `trimAlleles` when `fetchWindow` is omitted, returns `null`, or
 * encounters a non-ACGT ambiguous base during left-shifting.
 */
export function leftAlignAlleles(
  pos: number,
  ref: string,
  alt: string,
  fetchWindow?: ReferenceWindowLookup | null
): TrimmedAlleles {
  if (fetchWindow == null || isSymbolic(alt) || isSymbolic(ref) || ref === alt) {
    return trimAlleles(pos, ref, alt)
  }
  // Single-base substitutions cannot left-shift.
  if (ref.length === 1 && alt.length === 1) return { pos, ref, alt }

  let curPos = pos
  let curRef = ref
  let curAlt = alt
  let winStart = 0
  let winSeq = ''

  const prevBase = (at1Based: number): string | null => {
    if (at1Based < 1) return null
    if (winSeq === '' || at1Based < winStart || at1Based >= winStart + winSeq.length) {
      const chunkStart = Math.max(1, at1Based - 63)
      const fetched = fetchWindow(chunkStart, at1Based)
      if (fetched == null || fetched.length !== at1Based - chunkStart + 1) return null
      winStart = chunkStart
      winSeq = fetched.toUpperCase()
    }
    const base = winSeq[at1Based - winStart]
    return base === 'A' || base === 'C' || base === 'G' || base === 'T' ? base : null
  }

  for (;;) {
    while (
      curRef.length > 0 &&
      curAlt.length > 0 &&
      curRef[curRef.length - 1].toUpperCase() === curAlt[curAlt.length - 1].toUpperCase()
    ) {
      curRef = curRef.slice(0, -1)
      curAlt = curAlt.slice(0, -1)
    }
    if (curRef.length === 0 || curAlt.length === 0) {
      const base = prevBase(curPos - 1)
      if (base === null) return trimAlleles(pos, ref, alt)
      curPos -= 1
      curRef = base + curRef
      curAlt = base + curAlt
      if (curRef[curRef.length - 1].toUpperCase() === curAlt[curAlt.length - 1].toUpperCase()) {
        continue
      }
    }
    break
  }

  return trimAlleles(curPos, curRef, curAlt)
}

/**
 * Small variants are trimmed; SV/CNV/STR records keep their alleles, since
 * their identity is the locus (POS..END), not the sequence. Shared by the VCF
 * import and the v57 / PG 0040 migration so both decide alike.
 */
export function isTrimmableVariantType(type: string | null): boolean {
  return type === 'snv' || type === 'indel'
}

/** The stored type after trimming: an indel that trims to one base each side is an SNV. */
export function trimmedVariantType<T extends string | null>(
  type: T,
  ref: string,
  alt: string
): T | 'snv' {
  return type === 'indel' && ref.length === 1 && alt.length === 1 ? 'snv' : type
}
