import { Transform, TransformCallback } from 'node:stream'
import type { Variant } from '../../database/types'
import {
  COLUMN_INDICES,
  IMPACT_DICTIONARY,
  resolveDictionaryValue,
  type DataDictionaries,
  type ColumnIndices
} from '../config/fieldMapping'
import type { RawVariantRow } from '../types'
import type { TranscriptInsertRow } from '../../../shared/types/transcript'

type MappedVariant = Omit<Variant, 'id' | 'case_id'>

type MappedVariantWithTranscripts = MappedVariant & {
  _transcripts?: TranscriptInsertRow[]
}

interface FieldMapperOptions {
  dictionaries: DataDictionaries
  /** Dynamic column indices resolved from header. Falls back to this.cols. */
  columnIndices?: ColumnIndices
}

export class FieldMapper extends Transform {
  private dictionaries: DataDictionaries
  private cols: ColumnIndices

  constructor(options: FieldMapperOptions) {
    super({ objectMode: true })
    this.dictionaries = options.dictionaries
    this.cols = options.columnIndices ?? COLUMN_INDICES
  }

  _transform(
    chunk: { key: number; value: RawVariantRow },
    _encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    try {
      const row = chunk.value
      const selectedTranscript = (row[this.cols.SELECTED_TRANSCRIPT] as number) ?? 0

      const mapped: MappedVariant = {
        chr: this.extractValue(row, this.cols.CHR, selectedTranscript, false) as string,
        pos: this.extractValue(row, this.cols.POS, selectedTranscript, false) as number,
        ref: row[this.cols.REF] as string,
        alt: row[this.cols.ALT] as string,
        gene_symbol: this.extractValue(
          row,
          this.cols.GENE,
          selectedTranscript,
          true,
          this.dictionaries.gene
        ) as string | null,
        omim_mim_number: this.extractValue(
          row,
          this.cols.OMIM,
          selectedTranscript,
          false,
          undefined
        ) as string | null,
        consequence: this.extractValue(
          row,
          this.cols.IMPACT,
          selectedTranscript,
          true,
          IMPACT_DICTIONARY
        ) as string | null,
        gnomad_af: this.extractValue(row, this.cols.GNOMAD_AF, selectedTranscript, false) as
          | number
          | null,
        cadd: this.extractValue(row, this.cols.CADD, selectedTranscript, false) as number | null,
        clinvar: this.extractValue(row, this.cols.CLINVAR, selectedTranscript, false) as
          | string
          | null,
        gt_num: this.extractValue(row, this.cols.GT_NUM, selectedTranscript, false) as
          | string
          | null,
        func: this.extractValue(row, this.cols.FUNC, selectedTranscript, false) as string | null,
        qual: this.extractValue(row, this.cols.QUAL, selectedTranscript, false) as number | null,
        hpo_sim_score: this.extractNumericFromDict(
          row,
          this.cols.HPO_SIM_SCORE,
          selectedTranscript,
          this.dictionaries.hpoSimScore
        ),
        transcript: this.extractValue(
          row,
          this.cols.TRANSCRIPT,
          selectedTranscript,
          true,
          this.dictionaries.transcript
        ) as string | null,
        cdna: this.extractValue(row, this.cols.CDNA, selectedTranscript, false) as string | null,
        aa_change: this.extractValue(row, this.cols.AA_CHANGE, selectedTranscript, false) as
          | string
          | null,
        moi: this.extractValue(
          row,
          this.cols.MOI,
          selectedTranscript,
          true,
          this.dictionaries.moi
        ) as string | null,
        gq: null,
        dp: null,
        ad_ref: null,
        ad_alt: null,
        ab: null,
        filter: null,
        info_json: null,
        source_format: null
      }

      // Extract all transcript annotations
      const transcripts = this.extractAllTranscripts(row, selectedTranscript)

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

      const output: MappedVariantWithTranscripts = mapped
      if (transcripts.length > 0) {
        output._transcripts = transcripts
      }
      this.push(output)
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

  /**
   * Extract all transcript annotations from multi-value arrays.
   * Returns one TranscriptInsertRow per transcript in the source data.
   */
  private extractAllTranscripts(
    row: RawVariantRow,
    selectedTranscript: number
  ): TranscriptInsertRow[] {
    const transcriptCol = row[this.cols.TRANSCRIPT]
    const isArray = Array.isArray(transcriptCol)
    const count = isArray ? (transcriptCol as unknown[]).length : transcriptCol != null ? 1 : 0

    if (count === 0) return []

    // Resolve selected transcript ID up front so dedup doesn't lose the is_selected flag
    const selectedTranscriptId = this.extractValue(
      row,
      this.cols.TRANSCRIPT,
      selectedTranscript,
      true,
      this.dictionaries.transcript
    ) as string | null

    const transcripts: TranscriptInsertRow[] = []
    const seen = new Set<string>()

    for (let i = 0; i < count; i++) {
      const transcriptId = this.extractValue(
        row,
        this.cols.TRANSCRIPT,
        i,
        true,
        this.dictionaries.transcript
      ) as string | null
      if (transcriptId === null || seen.has(transcriptId)) continue
      seen.add(transcriptId)

      transcripts.push({
        transcript_id: transcriptId,
        gene_symbol: this.extractValue(row, this.cols.GENE, i, true, this.dictionaries.gene) as
          | string
          | null,
        consequence: this.extractValue(row, this.cols.IMPACT, i, true, IMPACT_DICTIONARY) as
          | string
          | null,
        cdna: this.extractValue(row, this.cols.CDNA, i, false) as string | null,
        aa_change: this.extractValue(row, this.cols.AA_CHANGE, i, false) as string | null,
        hpo_sim_score: this.extractNumericFromDict(
          row,
          this.cols.HPO_SIM_SCORE,
          i,
          this.dictionaries.hpoSimScore
        ),
        moi: this.extractValue(row, this.cols.MOI, i, true, this.dictionaries.moi) as string | null,
        is_selected: transcriptId === selectedTranscriptId ? 1 : 0
      })
    }

    return transcripts
  }
}

export function createFieldMapper(
  dictionaries: DataDictionaries,
  columnIndices?: ColumnIndices
): FieldMapper {
  return new FieldMapper({ dictionaries, columnIndices })
}
