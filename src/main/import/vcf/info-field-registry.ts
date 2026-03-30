/**
 * Configurable INFO field registry
 *
 * Data-driven mapping from VCF INFO field IDs to VarLens variant columns.
 * Extensible for any VCF-based format (SNV, CNV, STR, SV) without code changes.
 */

import type { InfoFieldMapping, InfoFieldResult, AnnotationResult, InfoFieldDef } from './types'

/** Fields that are handled by the annotation parser and should not go to info_json */
const ANNOTATION_INFO_IDS = new Set(['CSQ', 'ANN'])

/** Default registry covering common annotation pipelines */
export const DEFAULT_INFO_FIELD_MAPPINGS: InfoFieldMapping[] = [
  {
    infoIds: ['gnomADe_AF', 'gnomADg_AF', 'gnomAD_AF', 'AF'],
    column: 'gnomad_af',
    type: 'float',
    csqField: 'gnomADe_AF',
    description: 'gnomAD population allele frequency'
  },
  {
    infoIds: ['CADD_phred', 'dbNSFP_CADD_phred', 'CADD_PHRED'],
    column: 'cadd',
    type: 'float',
    csqField: 'CADD_PHRED',
    description: 'CADD phred-scaled score'
  },
  {
    infoIds: ['CLNSIG', 'CLINVAR_CLNSIG', 'ClinVar_CLNSIG'],
    column: 'clinvar',
    type: 'string',
    csqField: 'ClinVar_CLNSIG',
    description: 'ClinVar clinical significance'
  }
]

/**
 * Column name to AnnotationResult field mapping for priority checking.
 * If the annotation parser already populated a column, the registry skips it.
 */
const COLUMN_TO_ANNOTATION_FIELD: Record<string, keyof AnnotationResult> = {
  gnomad_af: 'gnomadAf',
  cadd: 'cadd',
  clinvar: 'clinvar'
}

/**
 * Apply the INFO field registry to a variant's INFO fields.
 *
 * Resolution priority:
 * 1. CSQ/ANN annotation values (already set) — skip if annotation provided a value
 * 2. Standalone INFO fields matched by registry — map to typed column
 * 3. Unmapped INFO fields — store in info_json
 *
 * @param info - Raw INFO key-value pairs from VcfRawRecord
 * @param registry - Field mapping registry (default: DEFAULT_INFO_FIELD_MAPPINGS)
 * @param annotation - Annotation result (to check for already-populated columns)
 * @returns Mapped values and unmapped info_json
 */
export function applyInfoFieldRegistry(
  info: Map<string, string>,
  registry: InfoFieldMapping[],
  annotation: AnnotationResult
): InfoFieldResult {
  const mappedValues = new Map<string, string | number | null>()
  const unmapped: Record<string, string> = {}

  // Build a reverse lookup: INFO ID -> mapping
  const infoIdToMapping = new Map<string, InfoFieldMapping>()
  for (const mapping of registry) {
    for (const infoId of mapping.infoIds) {
      infoIdToMapping.set(infoId, mapping)
    }
  }

  // Process each INFO field
  for (const [key, value] of info) {
    // Skip annotation fields (CSQ/ANN are handled separately)
    if (ANNOTATION_INFO_IDS.has(key)) continue

    const mapping = infoIdToMapping.get(key)

    if (mapping) {
      // Check if the annotation parser already provided this column's value
      const annotationField = COLUMN_TO_ANNOTATION_FIELD[mapping.column]
      if (annotationField && annotation[annotationField] !== null) {
        // Annotation value takes priority — don't override
        continue
      }

      // Parse and map the value
      const parsed = parseInfoValue(value, mapping.type)
      if (parsed !== undefined) {
        mappedValues.set(mapping.column, parsed)
      }
    } else {
      // Unmapped — goes to info_json
      unmapped[key] = value
    }
  }

  const infoJson = Object.keys(unmapped).length > 0 ? unmapped : null

  return { mappedValues, infoJson }
}

/**
 * Parse a raw INFO value string to the specified type.
 */
function parseInfoValue(
  value: string,
  type: 'float' | 'integer' | 'string'
): string | number | null | undefined {
  if (value === '.' || value === '') return null

  switch (type) {
    case 'float': {
      const parsed = parseFloat(value)
      return isNaN(parsed) ? null : parsed
    }
    case 'integer': {
      const parsed = parseInt(value, 10)
      return isNaN(parsed) ? null : parsed
    }
    case 'string':
      return value
    default:
      return value
  }
}

/**
 * Get field-to-column mapping info for the VCF preview UI.
 * Shows which INFO fields map to which VarLens columns (or info_json).
 */
export function getFieldColumnMapping(
  infoDefs: Map<string, InfoFieldDef>,
  registry: InfoFieldMapping[] = DEFAULT_INFO_FIELD_MAPPINGS
): Array<{
  id: string
  type: string
  number: string
  description: string
  mapsToColumn: string | null
}> {
  // Build reverse lookup
  const infoIdToColumn = new Map<string, string>()
  for (const mapping of registry) {
    for (const infoId of mapping.infoIds) {
      infoIdToColumn.set(infoId, mapping.column)
    }
  }

  const result: Array<{
    id: string
    type: string
    number: string
    description: string
    mapsToColumn: string | null
  }> = []

  for (const [id, def] of infoDefs) {
    if (ANNOTATION_INFO_IDS.has(id)) continue

    result.push({
      id,
      type: def.type,
      number: def.number,
      description: def.description,
      mapsToColumn: infoIdToColumn.get(id) ?? null
    })
  }

  return result
}
