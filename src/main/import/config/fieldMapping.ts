import {
  COLUMNAR_HEADER_TO_SLOT,
  type ColumnarSlot
} from '../../../shared/config/import-fields.config'

/** Column name keys used internally by FieldMapper */
export type ColumnName = ColumnarSlot

// Default column indices — only used as fallback when header is unavailable
export const COLUMN_INDICES: Readonly<Record<ColumnName, number>> = {
  SELECTED_TRANSCRIPT: 1,
  CHR: 9,
  POS: 10,
  REF: 11,
  ALT: 12,
  QUAL: 14,
  GT_NUM: 15,
  FUNC: 20,
  IMPACT: 21,
  GENE: 24,
  OMIM: 25,
  TRANSCRIPT: 28,
  CDNA: 29,
  AA_CHANGE: 30,
  CADD: 46,
  CLINVAR: 72,
  GNOMAD_AF: 108,
  HPO_SIM_SCORE: 156,
  // Not at a known position in header-less files.
  HPO_MATCH: -1,
  MOI: 162
}

/** Type for dynamic column indices resolved from header */
export type ColumnIndices = Record<ColumnName, number>

/** Index of a slot the header does not carry: `row[-1]` reads as missing. */
export const ABSENT_COLUMN = -1

/**
 * Build the column index map from the header field IDs. A slot the header
 * lacks is absent, never read from its default position (#590); only a file
 * without a header falls back to the COLUMN_INDICES defaults.
 */
export function resolveColumnIndices(header: { id: string }[]): ColumnIndices {
  if (header.length === 0) return { ...COLUMN_INDICES }
  const indices = Object.fromEntries(
    Object.keys(COLUMN_INDICES).map((slot) => [slot, ABSENT_COLUMN])
  ) as ColumnIndices

  for (let i = 0; i < header.length; i++) {
    const columnName = COLUMNAR_HEADER_TO_SLOT[header[i].id]
    if (columnName !== undefined) {
      indices[columnName] = i
    }
  }

  return indices
}

// Data dictionaries (loaded from header at parse time)
export interface DataDictionaries {
  gene: Record<string, string> // Gene ID -> symbol
  impact: Record<string, string> // Impact code -> label
  transcript: Record<string, string> // Transcript ID -> name
  hpoSimScore: Record<string, number> // ID -> score
  moi: Record<string, string> // ID -> abbreviation (AD/AR)
}

// Static Impact dictionary (constant across files)
export const IMPACT_DICTIONARY: Record<string, string> = {
  '1': 'HIGH',
  '2': 'MODERATE',
  '3': 'LOW',
  '4': 'MODIFIER'
}

// Helper function to resolve dictionary value
export function resolveDictionaryValue(
  value: string | number | null,
  dictionary: Record<string, string> | null
): string | null {
  if (value === null || value === undefined) return null
  if (dictionary === null) return String(value)
  return dictionary[String(value)] ?? String(value)
}
