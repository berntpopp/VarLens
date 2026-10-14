/**
 * Trim-only allele normalisation (#587): strip the common suffix, then the
 * common prefix, keeping one base on each side so an indel keeps its VCF
 * anchor base; `pos` moves by the prefix removed. `ATT>AT` becomes `AT>A`,
 * `ACG>ATG` becomes `C>T` at pos+1. Comparison is exact (callers upper-case
 * when they need case-insensitive identity).
 *
 * ponytail: no reference sequence here, so repeat-shifted indels are not
 * left-aligned (`CA>C` at 100 and `AA>A` at 101 in `CAA` stay distinct);
 * that needs a reference FASTA.
 */
export interface TrimmedAlleles {
  pos: number
  ref: string
  alt: string
}

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
 * Small variants are trimmed; SV/CNV/STR records keep their alleles, since
 * their identity is the locus (POS..END), not the sequence. Shared by the VCF
 * import and the v57 / PG 0040 migration so both decide alike.
 */
export function isTrimmableVariantType(type: string | null): boolean {
  return type === 'snv' || type === 'indel'
}

/** The stored type after trimming: an indel that trims to one base each side is an SNV. */
export function trimmedVariantType<T extends string | null>(type: T, ref: string, alt: string): T | 'snv' {
  return type === 'indel' && ref.length === 1 && alt.length === 1 ? 'snv' : type
}
