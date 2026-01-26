import type { FieldMapping } from '../types'

// Column indices for direct access
export const COLUMN_INDICES = {
  SELECTED_TRANSCRIPT: 1,
  CHR: 9,
  POS: 10,
  REF: 11,
  ALT: 12,
  IMPACT: 21,
  GENE: 24,
  CADD: 46,
  CLINVAR: 72,
  GNOMAD_AF: 108
} as const

// Data dictionaries (loaded from header at parse time)
export interface DataDictionaries {
  gene: Record<string, string> // Gene ID -> symbol
  impact: Record<string, string> // Impact code -> label
}

// Static Impact dictionary (constant across files)
export const IMPACT_DICTIONARY: Record<string, string> = {
  '1': 'HIGH',
  '2': 'MODERATE',
  '3': 'LOW',
  '4': 'MODIFIER'
}

// Field mappings array
export const FIELD_MAPPINGS: FieldMapping[] = [
  { source: 'Chr', sourceIndex: 9, target: 'chr', isMultiValue: true, hasDictionary: false },
  { source: 'Pos', sourceIndex: 10, target: 'pos', isMultiValue: true, hasDictionary: false },
  { source: 'Ref', sourceIndex: 11, target: 'ref', isMultiValue: false, hasDictionary: false },
  { source: 'Alt', sourceIndex: 12, target: 'alt', isMultiValue: false, hasDictionary: false },
  {
    source: 'Gene',
    sourceIndex: 24,
    target: 'gene_symbol',
    isMultiValue: true,
    hasDictionary: true
  },
  {
    source: 'Impact',
    sourceIndex: 21,
    target: 'consequence',
    isMultiValue: true,
    hasDictionary: true
  },
  {
    source: 'GnomPMaxFiltAF',
    sourceIndex: 108,
    target: 'gnomad_af',
    isMultiValue: false,
    hasDictionary: false
  },
  {
    source: 'CADDPhredScore',
    sourceIndex: 46,
    target: 'cadd',
    isMultiValue: false,
    hasDictionary: false
  },
  {
    source: 'ClinVSig',
    sourceIndex: 72,
    target: 'clinvar',
    isMultiValue: false,
    hasDictionary: false
  }
]

// Helper function to resolve dictionary value
export function resolveDictionaryValue(
  value: string | number | null,
  dictionary: Record<string, string> | null
): string | null {
  if (value === null || value === undefined) return null
  if (!dictionary) return String(value)
  return dictionary[String(value)] ?? String(value)
}
