import type { VariantType } from './import-filters'

/**
 * Detect variant type from VCF record content.
 *
 * @param ref - REF allele
 * @param alt - Single ALT allele (already split from multi-allelic)
 * @param info - INFO field map
 * @param callerName - Detected caller name (null if unknown)
 */
export function detectVariantType(
  ref: string,
  alt: string,
  info: Map<string, string>,
  callerName: string | null
): VariantType {
  const svtype = info.get('SVTYPE')
  const cnvCallers = ['Spectre', 'DRAGEN_CNV', 'CNVkit', 'ExomeDepth', 'GATK_gCNV']
  const isCnvCaller =
    callerName !== null &&
    callerName !== '' &&
    cnvCallers.some((c) => callerName.includes(c))

  // Symbolic ALT alleles
  if (alt.startsWith('<')) {
    // STR: <STRn> symbolic or SVTYPE=STR
    if (alt.startsWith('<STR') || svtype === 'STR') return 'str'

    // CNV: <CNV> symbolic or SVTYPE=CNV
    if (alt.startsWith('<CNV') || svtype === 'CNV') return 'cnv'

    // DEL/DUP: caller disambiguates CNV vs SV
    if (alt === '<DEL>' || alt === '<DUP>') {
      if (isCnvCaller) return 'cnv'
      return 'sv'
    }

    // Other symbolic: INS, INV, BND
    return 'sv'
  }

  // Breakend notation
  if (alt.includes('[') || alt.includes(']')) return 'sv'

  // Sequence ALT with SVTYPE info: trust the caller — it's a structural variant
  // even though it's written as a sequence (e.g., Sniffles2 INS records).
  if (svtype !== undefined && svtype !== '') {
    if (svtype === 'STR') return 'str'
    if (svtype === 'CNV') return 'cnv'
    if ((svtype === 'DEL' || svtype === 'DUP') && isCnvCaller) return 'cnv'
    // INS, DEL, DUP, INV, BND from SV callers
    return 'sv'
  }

  // Sequence ALT without SVTYPE: SNV vs indel by length
  if (ref.length === 1 && alt.length === 1) return 'snv'
  return 'indel'
}
