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
        consequence: this.extractValue(
          row,
          COLUMN_INDICES.IMPACT,
          selectedTranscript,
          true,
          IMPACT_DICTIONARY
        ) as string | null,
        gnomad_af: row[COLUMN_INDICES.GNOMAD_AF] as number | null,
        cadd: row[COLUMN_INDICES.CADD] as number | null,
        clinvar: row[COLUMN_INDICES.CLINVAR] as string | null
      }

      // Validate required fields
      if (
        !mapped.chr ||
        mapped.pos === undefined ||
        mapped.pos === null ||
        !mapped.ref ||
        !mapped.alt
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

    // Handle multi-value arrays
    if (Array.isArray(value)) {
      const selected = value[transcriptIndex] ?? value[0] ?? null
      if (useDictionary && dictionary) {
        return resolveDictionaryValue(selected, dictionary)
      }
      return selected
    }

    // Handle single values
    if (useDictionary && dictionary) {
      return resolveDictionaryValue(value, dictionary)
    }

    return value
  }
}

export function createFieldMapper(dictionaries: DataDictionaries): FieldMapper {
  return new FieldMapper({ dictionaries })
}
