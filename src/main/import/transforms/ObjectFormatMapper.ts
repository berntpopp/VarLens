import { Transform, TransformCallback } from 'node:stream'
import type { Variant } from '../../database/types'
import type { TranscriptInsertRow } from '../../../shared/types/transcript'
import { canonicalizeTranscriptSemantics } from '../../../shared/types/transcript'
import { setRecordBytes } from '../bounded-batcher'
import { OBJECT_FORMAT_COLUMNS } from '../../../shared/config/import-fields.config'
import { FieldProfileResolver, jsonValueText } from '../../../shared/utils/import-field-profile'

type MappedVariant = Omit<Variant, 'id' | 'case_id'>

type MappedVariantWithTranscripts = MappedVariant & {
  _transcripts?: TranscriptInsertRow[]
}

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
  /** Patient HPO terms that matched the gene (varvis), same item shape as `moi`. */
  hpo_match?: MoiItem[] | null
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

/** Matched HPO terms as `HP:0004322 Short stature; …` (id = abbreviation); null when none. */
function hpoMatchText(value: unknown): string | null {
  if (!Array.isArray(value)) return normalizeString(value)
  const terms = value
    .map((item: Partial<MoiItem> | null) =>
      [item?.abbreviation, item?.name]
        .filter((part) => typeof part === 'string' && part !== '')
        .join(' ')
    )
    .filter((term) => term !== '')
  return terms.length > 0 ? terms.join('; ') : null
}

/**
 * ObjectFormatMapper - Transform stream that maps object-based variants to database format.
 *
 * This handles the "new" export format where variants are full objects with named properties,
 * as opposed to the columnar format with positional tuples.
 */
export class ObjectFormatMapper extends Transform {
  /**
   * @param takeRecordBytes source size of the next input record, if tracked
   * @param onSkip told about every record dropped for a missing required field
   * @param fields decides where properties without a column go (default: keep all)
   */
  constructor(
    private readonly takeRecordBytes?: () => number,
    private readonly onSkip?: (reason: string) => void,
    private readonly fields: FieldProfileResolver = new FieldProfileResolver()
  ) {
    super({ objectMode: true })
  }

  /** Properties without a column as `info_json`, per the field profile. */
  private infoJson(variant: ObjectFormatVariant): string | null {
    const record = this.fields.record()
    for (const [name, value] of Object.entries(variant)) {
      if (Object.prototype.hasOwnProperty.call(OBJECT_FORMAT_COLUMNS, name)) continue
      const text = jsonValueText(value)
      if (text !== null) record.set('JSON', name, text)
    }
    return record.toJson()
  }

  _transform(
    chunk: { key: number; value: ObjectFormatVariant },
    _encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    try {
      const recordBytes = this.takeRecordBytes?.()
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

      const semantics = canonicalizeTranscriptSemantics(
        normalizeString(variant.consequence),
        normalizeString(variant.func)
      )
      const mapped: MappedVariant = {
        chr: normalizeString(variant.chr) ?? '',
        // A missing position stays null and is rejected below, not stored as 0.
        pos: normalizeNumber(variant.pos) as number,
        ref: normalizeString(variant.ref) ?? '',
        alt: normalizeString(variant.alt) ?? '',
        gene_symbol: normalizeString(variant.gene_symbol),
        omim_mim_number: normalizeString(variant.omim_mim_number),
        consequence: semantics.consequence,
        gnomad_af: normalizeNumber(variant.gnomad_af),
        cadd: normalizeNumber(variant.cadd),
        clinvar: normalizeString(variant.clinvar),
        gt_num: normalizeString(variant.gt_num),
        func: semantics.func,
        qual: normalizeNumber(variant.qual),
        hpo_sim_score: normalizeNumber(variant.hpo_sim_score),
        transcript: normalizeString(variant.transcript),
        cdna: normalizeString(variant.cdna),
        aa_change: normalizeString(variant.aa_change),
        moi: moiString,
        hpo_match: hpoMatchText(variant.hpo_match),
        gq: null,
        dp: null,
        ad_ref: null,
        ad_alt: null,
        ab: null,
        filter: null,
        info_json: this.infoJson(variant),
        source_format: null
      }

      // Build single transcript row if transcript is present
      if (mapped.transcript !== null) {
        ;(mapped as MappedVariantWithTranscripts)._transcripts = [
          {
            transcript_id: mapped.transcript,
            gene_symbol: mapped.gene_symbol,
            consequence: mapped.consequence,
            func: mapped.func,
            cdna: mapped.cdna,
            aa_change: mapped.aa_change,
            hpo_sim_score: mapped.hpo_sim_score,
            moi: mapped.moi,
            is_selected: 1
          }
        ]
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
        this.onSkip?.('JSON variant without chr, pos, ref or alt')
        callback(null)
        return
      }

      if (recordBytes !== undefined) setRecordBytes(mapped, recordBytes)
      this.push(mapped as MappedVariantWithTranscripts)
      callback()
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)))
    }
  }
}

export function createObjectFormatMapper(
  takeRecordBytes?: () => number,
  onSkip?: (reason: string) => void,
  fields?: FieldProfileResolver
): ObjectFormatMapper {
  return new ObjectFormatMapper(takeRecordBytes, onSkip, fields)
}
