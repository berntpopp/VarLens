import { Transform, TransformCallback } from 'node:stream'
import type { Variant } from '../../database/types'
import {
  COLUMN_INDICES,
  IMPACT_DICTIONARY,
  resolveDictionaryValue,
  type DataDictionaries
} from '../config/fieldMapping'
import type { RawVariantRow } from '../types'

type MappedVariant = Omit<Variant, 'id' | 'case_id'>

interface FieldMapperOptions {
  dictionaries: DataDictionaries
}

export class FieldMapper extends Transform {
  private dictionaries: DataDictionaries

  constructor(options: FieldMapperOptions) {
    super({ objectMode: true })
    this.dictionaries = options.dictionaries
  }

  _transform(
    chunk: { key: number; value: RawVariantRow },
    _encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    try {
      const row = chunk.value
      const selectedTranscript = (row[COLUMN_INDICES.SELECTED_TRANSCRIPT] as number) ?? 0

      const mapped: MappedVariant = {
        chr: this.extractValue(row, COLUMN_INDICES.CHR, selectedTranscript, false) as string,
        pos: this.extractValue(row, COLUMN_INDICES.POS, selectedTranscript, false) as number,
        ref: row[COLUMN_INDICES.REF] as string,
        alt: row[COLUMN_INDICES.ALT] as string,
        gene_symbol: this.extractValue(
          row,
          COLUMN_INDICES.GENE,
          selectedTranscript,
          true,
          this.dictionaries.gene
        ) as string | null,
        omim_mim_number: this.extractValue(
          row,
          COLUMN_INDICES.OMIM,
          selectedTranscript,
          false,
          undefined
        ) as string | null,
        consequence: this.extractValue(
          row,
          COLUMN_INDICES.IMPACT,
          selectedTranscript,
          true,
          IMPACT_DICTIONARY
        ) as string | null,
        gnomad_af: this.extractValue(row, COLUMN_INDICES.GNOMAD_AF, selectedTranscript, false) as
          | number
          | null,
        cadd: this.extractValue(row, COLUMN_INDICES.CADD, selectedTranscript, false) as
          | number
          | null,
        clinvar: this.extractValue(row, COLUMN_INDICES.CLINVAR, selectedTranscript, false) as
          | string
          | null,
        gt_num: this.extractValue(row, COLUMN_INDICES.GT_NUM, selectedTranscript, false) as
          | string
          | null,
        func: this.extractValue(row, COLUMN_INDICES.FUNC, selectedTranscript, false) as
          | string
          | null,
        qual: this.extractValue(row, COLUMN_INDICES.QUAL, selectedTranscript, false) as
          | number
          | null,
        hpo_sim_score: this.extractNumericFromDict(
          row,
          COLUMN_INDICES.HPO_SIM_SCORE,
          selectedTranscript,
          this.dictionaries.hpoSimScore
        ),
        transcript: this.extractValue(
          row,
          COLUMN_INDICES.TRANSCRIPT,
          selectedTranscript,
          true,
          this.dictionaries.transcript
        ) as string | null,
        cdna: this.extractValue(row, COLUMN_INDICES.CDNA, selectedTranscript, false) as
          | string
          | null,
        aa_change: this.extractValue(row, COLUMN_INDICES.AA_CHANGE, selectedTranscript, false) as
          | string
          | null,
        moi: this.extractValue(
          row,
          COLUMN_INDICES.MOI,
          selectedTranscript,
          true,
          this.dictionaries.moi
        ) as string | null
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

  private extractValue(
    row: RawVariantRow,
    columnIndex: number,
    transcriptIndex: number,
    useDictionary: boolean,
    dictionary?: Record<string, string>
  ): string | number | null {
    const value = row[columnIndex]

    // Handle multi-value arrays (may be nested)
    const isValueArray: boolean = Array.isArray(value)
    if (isValueArray) {
      let selected =
        (value as (string | number | null)[])[transcriptIndex] ??
        (value as (string | number | null)[])[0] ??
        null
      // Handle nested arrays - unwrap if the selected value is still an array
      const isSelectedArray: boolean = Array.isArray(selected)
      if (isSelectedArray) {
        selected = (selected as unknown as (string | number | null)[])[0] ?? null
      }
      if (useDictionary && dictionary !== undefined) {
        return resolveDictionaryValue(selected, dictionary)
      }
      return selected
    }

    // Handle single values
    if (useDictionary && dictionary !== undefined) {
      return resolveDictionaryValue(value as string | number | null, dictionary)
    }

    return value as string | number | null
  }

  /**
   * Extract a numeric value using a dictionary that maps IDs to numbers.
   * Used for HPO similarity score.
   */
  private extractNumericFromDict(
    row: RawVariantRow,
    columnIndex: number,
    transcriptIndex: number,
    dictionary: Record<string, number>
  ): number | null {
    const value = row[columnIndex]

    // Handle multi-value arrays
    let selected: unknown = value
    const isValueArray: boolean = Array.isArray(value)
    if (isValueArray) {
      selected = (value as unknown[])[transcriptIndex] ?? (value as unknown[])[0] ?? null
      // Handle nested arrays
      const isSelectedArray: boolean = Array.isArray(selected)
      if (isSelectedArray) {
        selected = (selected as unknown[])[0] ?? null
      }
    }

    if (selected === null || selected === undefined) {
      return null
    }

    // Look up in dictionary
    const key = String(selected)
    const result = dictionary[key]
    return result !== undefined ? result : null
  }
}

export function createFieldMapper(dictionaries: DataDictionaries): FieldMapper {
  return new FieldMapper({ dictionaries })
}
