import { Transform, TransformCallback } from 'node:stream'
import type { Variant } from '../../database/types'

type MappedVariant = Omit<Variant, 'id' | 'case_id'>

/**
 * Mode of inheritance object from object-based export format
 */
interface MoiItem {
  accessionId: number
  name: string
  abbreviation: string | null
}

/**
 * Raw variant object from object-based export format
 */
export interface ObjectFormatVariant {
  lims_id?: string
  person_id?: number
  analysis_id?: number
  chr: string
  pos: number
  ref: string
  alt: string
  gene_symbol?: string | null
  omim_mim_number?: string | null
  consequence?: string | null
  gnomad_af?: number | null
  cadd?: number | null
  clinvar?: string | null
  gt_num?: string | null
  func?: string | null
  qual?: number | null
  hpo_sim_score?: number | null
  transcript?: string | null
  cdna?: string | null
  aa_change?: string | null
  moi?: MoiItem[] | null
}

/**
 * Normalize a value that should be a string or null.
 * Handles edge cases like empty arrays, "[]" strings, etc.
 */
function normalizeString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : null
  if (typeof value === 'string') {
    // Handle stringified empty arrays like "[]"
    if (value === '[]' || value === '') return null
    return value
  }
  return String(value)
}

/**
 * Normalize a value that should be a number or null.
 * Handles edge cases like empty arrays, strings, etc.
 */
function normalizeNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) return value.length > 0 ? Number(value[0]) : null
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const num = parseFloat(value)
    return isNaN(num) ? null : num
  }
  return null
}

/**
 * ObjectFormatMapper - Transform stream that maps object-based variants to database format.
 *
 * This handles the "new" export format where variants are full objects with named properties,
 * as opposed to the columnar format with positional tuples.
 */
export class ObjectFormatMapper extends Transform {
  constructor() {
    super({ objectMode: true })
  }

  _transform(
    chunk: { key: number; value: ObjectFormatVariant },
    _encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    try {
      const variant = chunk.value

      // Convert moi array to string format (using abbreviations)
      let moiString: string | null = null
      if (variant.moi !== null && variant.moi !== undefined) {
        const isArray: boolean = Array.isArray(variant.moi)
        if (isArray && variant.moi.length > 0) {
          // Extract abbreviations, filter out nulls, join with comma
          const abbrevs = variant.moi
            .map((item) => item.abbreviation)
            .filter((abbr): abbr is string => abbr !== null && abbr !== undefined)
          if (abbrevs.length > 0) {
            moiString = abbrevs.join(', ')
          }
        }
      }

      const mapped: MappedVariant = {
        chr: normalizeString(variant.chr) ?? '',
        pos: normalizeNumber(variant.pos) ?? 0,
        ref: normalizeString(variant.ref) ?? '',
        alt: normalizeString(variant.alt) ?? '',
        gene_symbol: normalizeString(variant.gene_symbol),
        omim_mim_number: normalizeString(variant.omim_mim_number),
        consequence: normalizeString(variant.consequence),
        gnomad_af: normalizeNumber(variant.gnomad_af),
        cadd: normalizeNumber(variant.cadd),
        clinvar: normalizeString(variant.clinvar),
        gt_num: normalizeString(variant.gt_num),
        func: normalizeString(variant.func),
        qual: normalizeNumber(variant.qual),
        hpo_sim_score: normalizeNumber(variant.hpo_sim_score),
        transcript: normalizeString(variant.transcript),
        cdna: normalizeString(variant.cdna),
        aa_change: normalizeString(variant.aa_change),
        moi: moiString
      }

      // Validate required fields
      if (
        mapped.chr === undefined ||
        mapped.chr === null ||
        mapped.chr === '' ||
        mapped.pos === undefined ||
        mapped.pos === null ||
        mapped.ref === undefined ||
        mapped.ref === null ||
        mapped.ref === '' ||
        mapped.alt === undefined ||
        mapped.alt === null ||
        mapped.alt === ''
      ) {
        // Skip invalid variants - will be counted as skipped
        callback(null)
        return
      }

      this.push(mapped)
      callback()
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)))
    }
  }
}

export function createObjectFormatMapper(): ObjectFormatMapper {
  return new ObjectFormatMapper()
}
