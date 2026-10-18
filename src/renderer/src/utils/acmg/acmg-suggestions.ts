import type { AcmgEvidenceCode } from './types'
import { getDefaultStrength } from './types'

/**
 * Variant annotation data used for auto-suggestion
 */
export interface VariantAnnotationData {
  gnomad_af: number | null
  cadd: number | null
  clinvar: string | null
  revel?: number | null
  spliceai_max?: number | null
}

/**
 * Generate ACMG evidence code suggestions from variant annotations.
 * All suggestions are auto_suggested=true, confirmed=false.
 */
export function generateSuggestions(data: VariantAnnotationData): AcmgEvidenceCode[] {
  const suggestions: AcmgEvidenceCode[] = []
  const addedCodes = new Set<string>()

  function add(code: AcmgEvidenceCode['code'], source: string): void {
    if (addedCodes.has(code)) return
    addedCodes.add(code)
    suggestions.push({
      code,
      strength: getDefaultStrength(code),
      auto_suggested: true,
      confirmed: false,
      source
    })
  }

  // gnomAD allele frequency
  if (data.gnomad_af !== null) {
    if (data.gnomad_af > 0.05) {
      add('BA1', 'gnomad_af')
    } else if (data.gnomad_af >= 0.01) {
      add('BS1', 'gnomad_af')
    } else if (data.gnomad_af < 0.00001) {
      // ClinGen SVI: PM2 defaults to supporting via getDefaultStrength()
      add('PM2', 'gnomad_af')
    }
  }

  // CADD phred score
  if (data.cadd !== null) {
    if (data.cadd >= 25) {
      add('PP3', 'cadd')
    } else if (data.cadd < 15) {
      add('BP4', 'cadd')
    }
  }

  // REVEL score
  if (data.revel != null) {
    if (data.revel >= 0.7) {
      add('PP3', 'revel')
    } else if (data.revel < 0.3) {
      add('BP4', 'revel')
    }
  }

  // SpliceAI max score
  if (data.spliceai_max != null) {
    if (data.spliceai_max >= 0.5) {
      add('PP3', 'spliceai')
    }
  }

  // ClinVar classification — PP5/BP6 deprecated by ClinGen (2020), not auto-suggested

  return suggestions
}
