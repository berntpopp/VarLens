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

  // Symbolic ALT alleles
  if (alt.startsWith('<')) {
    // STR: <STRn> symbolic or SVTYPE=STR
    if (alt.startsWith('<STR') || svtype === 'STR') return 'str'

    // CNV: <CNV> symbolic or SVTYPE=CNV
    if (alt.startsWith('<CNV') || svtype === 'CNV') return 'cnv'

    // DEL/DUP: caller disambiguates CNV vs SV
    if (alt === '<DEL>' || alt === '<DUP>') {
      const cnvCallers = ['Spectre', 'DRAGEN_CNV', 'CNVkit', 'ExomeDepth', 'GATK_gCNV']
      if (
        callerName !== null &&
        callerName !== '' &&
        cnvCallers.some((c) => callerName.includes(c))
      ) {
        return 'cnv'
      }
      return 'sv'
    }

    // Other symbolic: INS, INV, BND
    return 'sv'
  }

  // Breakend notation
  if (alt.includes('[') || alt.includes(']')) return 'sv'

  // Sequence ALT: SNV vs indel
  if (ref.length === 1 && alt.length === 1) return 'snv'
  return 'indel'
}
