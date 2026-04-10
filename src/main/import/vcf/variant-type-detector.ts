import type { VariantType } from './import-filters'

/**
 * Callers that emit CNV-semantic DEL/DUP records rather than SV-semantic ones.
 *
 * NOTE: DRAGEN is deliberately NOT in this list — DRAGEN produces separate SNV,
 * SV, and CNV VCF files and the header source string is the same for all three
 * ("DRAGEN"). We cannot disambiguate CNV vs SV from the caller name alone, so
 * DRAGEN CNV files must rely on either `<CNV>` symbolic ALTs, `SVTYPE=CNV`, or
 * a user-supplied variant type hint via the import wizard.
 *
 * The name matching here is substring-based (caller-detector normalizes names
 * to e.g. 'Spectre', 'CNVkit', 'ExomeDepth', 'GATK_gCNV').
 */
const CNV_CALLERS = ['Spectre', 'CNVkit', 'ExomeDepth', 'GATK_gCNV'] as const

/** Known SV SVTYPE values — everything else falls through to SNV/indel heuristics. */
const SV_SVTYPES = new Set(['DEL', 'DUP', 'INS', 'INV', 'BND', 'TRA'])

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
  const isCnvCaller =
    callerName !== null && callerName !== '' && CNV_CALLERS.some((c) => callerName.includes(c))

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

    // Other symbolic: INS, INV, BND — classify as SV.
    return 'sv'
  }

  // Breakend notation
  if (alt.includes('[') || alt.includes(']')) return 'sv'

  // Sequence ALT with SVTYPE info: trust the caller — it's a structural variant
  // even though it's written as a sequence (e.g., Sniffles2 INS records).
  // Use a positive allow-list so non-standard SVTYPE values (e.g. SVTYPE=SNP in
  // broken VCFs) fall through to the REF/ALT-length classifier instead of being
  // mis-labelled as SV.
  if (svtype !== undefined && svtype !== '') {
    if (svtype === 'STR') return 'str'
    if (svtype === 'CNV') return 'cnv'
    if ((svtype === 'DEL' || svtype === 'DUP') && isCnvCaller) return 'cnv'
    if (SV_SVTYPES.has(svtype)) return 'sv'
    // Unknown SVTYPE — fall through to length heuristic below
  }

  // Sequence ALT without (valid) SVTYPE: SNV vs indel by length
  if (ref.length === 1 && alt.length === 1) return 'snv'
  return 'indel'
}
