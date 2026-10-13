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
import { canonicalizeTranscriptSemantics } from '../../../shared/types/transcript'
import { setRecordBytes } from '../bounded-batcher'
import { COLUMNAR_TRANSCRIPT_FIELDS } from '../../../shared/config/import-fields.config'
import {
  canonicalFieldFor,
  FieldProfileResolver,
  jsonValueText
} from '../../../shared/utils/import-field-profile'
import { IMPORT_MESSAGES } from '../../../shared/config/import.config'
import { hpoMatchText } from './hpo-match'

type MappedVariant = Omit<Variant, 'id' | 'case_id'>

type MappedVariantWithTranscripts = MappedVariant & {
  _transcripts?: TranscriptInsertRow[]
}

/** One columnar header column as the field profile needs it. */
export interface ColumnarHeaderItem {
  id: string
  dataDictionary?: Record<string, unknown> | null
  /** varvis value type (`text`, `number`, `dictionary`) and display label, for the preview. */
  type?: string
  label?: string
}

/** A header column the slot mapping leaves to the field profile. */
interface ProfileColumn {
  index: number
  name: string
  dictionary: Record<string, unknown> | null
  /** Already stored in a column: it only feeds its canonical key. */
  deriveOnly: boolean
  /** One value per transcript: the selected transcript's value is kept. */
  perTranscript: boolean
}

interface FieldMapperOptions {
  dictionaries: DataDictionaries
  /** The file's header: its unmapped columns go to the field profile. */
  header?: ColumnarHeaderItem[]
  /** Decides where the unmapped columns go (default: keep all). */
  fields?: FieldProfileResolver
  /** Dynamic column indices resolved from header. Falls back to this.cols. */
  columnIndices?: ColumnIndices
  /** Source size of the next input record, when the JSON budget tracks it. */
  takeRecordBytes?: () => number
  /** Told about every row dropped for a missing required field. */
  onSkip?: (reason: string) => void
  /** Number of header columns; a row of any other length would shift every later value. */
  columnCount?: number
}

export class FieldMapper extends Transform {
  private dictionaries: DataDictionaries
  private cols: ColumnIndices
  private readonly takeRecordBytes?: () => number
  private readonly onSkip?: (reason: string) => void
  private readonly fields: FieldProfileResolver
  private readonly profileColumns: ProfileColumn[]
  private readonly columnCount?: number
  private readonly hpoMatchLabel: (code: unknown) => unknown

  constructor(options: FieldMapperOptions) {
    super({ objectMode: true })
    this.dictionaries = options.dictionaries
    this.cols = options.columnIndices ?? COLUMN_INDICES
    this.takeRecordBytes = options.takeRecordBytes
    this.onSkip = options.onSkip
    this.columnCount = options.columnCount
    this.fields = options.fields ?? new FieldProfileResolver()
    this.profileColumns = profileColumnsOf(options.header ?? [], this.cols)
    this.hpoMatchLabel = dictionaryLabel(
      options.header?.[this.cols.HPO_MATCH]?.dataDictionary ?? null
    )
    this.fields.seed(
      'JSON',
      this.profileColumns.filter((c) => !c.deriveOnly).map((c) => c.name)
    )
  }

  _transform(
    chunk: { key: number; value: RawVariantRow },
    _encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    try {
      const recordBytes = this.takeRecordBytes?.()
      const row = chunk.value
      if (this.columnCount !== undefined && row.length !== this.columnCount) {
        throw new Error(
          IMPORT_MESSAGES.rowWidthMismatch(chunk.key + 1, row.length, this.columnCount)
        )
      }
      const selectedTranscript = (row[this.cols.SELECTED_TRANSCRIPT] as number) ?? 0
      const semantics = canonicalizeTranscriptSemantics(
        this.extractValue(row, this.cols.IMPACT, selectedTranscript, true, IMPACT_DICTIONARY) as
          string | null,
        this.extractValue(row, this.cols.FUNC, selectedTranscript, false) as string | null
      )

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
        consequence: semantics.consequence,
        gnomad_af: this.extractValue(row, this.cols.GNOMAD_AF, selectedTranscript, false) as
          number | null,
        cadd: this.extractValue(row, this.cols.CADD, selectedTranscript, false) as number | null,
        clinvar: this.extractValue(row, this.cols.CLINVAR, selectedTranscript, false) as
          string | null,
        gt_num: this.extractValue(row, this.cols.GT_NUM, selectedTranscript, false) as
          string | null,
        func: semantics.func,
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
          string | null,
        moi: this.extractValue(
          row,
          this.cols.MOI,
          selectedTranscript,
          true,
          this.dictionaries.moi
        ) as string | null,
        hpo_match: this.hpoMatch(row),
        gq: null,
        dp: null,
        ad_ref: null,
        ad_alt: null,
        ab: null,
        filter: null,
        info_json: this.infoJson(row, selectedTranscript),
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
        this.onSkip?.('JSON variant without chr, pos, ref or alt')
        callback(null)
        return
      }

      const output: MappedVariantWithTranscripts = mapped
      if (transcripts.length > 0) {
        output._transcripts = transcripts
      }
      if (recordBytes !== undefined) setRecordBytes(output, recordBytes)
      this.push(output)
      callback()
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /** The HpoMatch cell (term codes resolved through its dictionary) as `hpo_match` text. */
  private hpoMatch(row: RawVariantRow): string | null {
    const value: unknown = row[this.cols.HPO_MATCH]
    return hpoMatchText(
      Array.isArray(value) ? value.flat().map(this.hpoMatchLabel) : this.hpoMatchLabel(value)
    )
  }

  /** The row's unmapped columns as `info_json`, per the field profile. */
  private infoJson(row: RawVariantRow, selectedTranscript: number): string | null {
    if (this.profileColumns.length === 0) return null
    const record = this.fields.record()
    for (const column of this.profileColumns) {
      const text = columnarCellText(
        row[column.index],
        column.perTranscript ? selectedTranscript : null,
        column.dictionary
      )
      if (text === null) continue
      if (column.deriveOnly) record.deriveOnly('JSON', column.name, text)
      else record.set('JSON', column.name, text)
    }
    return record.toJson()
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

      const semantics = canonicalizeTranscriptSemantics(
        this.extractValue(row, this.cols.IMPACT, i, true, IMPACT_DICTIONARY) as string | null,
        this.extractValue(row, this.cols.FUNC, i, false) as string | null
      )
      transcripts.push({
        transcript_id: transcriptId,
        gene_symbol: this.extractValue(row, this.cols.GENE, i, true, this.dictionaries.gene) as
          string | null,
        consequence: semantics.consequence,
        func: semantics.func,
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

/** Header columns no slot reads, plus slot columns that also feed a canonical key. */
function profileColumnsOf(header: ColumnarHeaderItem[], cols: ColumnIndices): ProfileColumn[] {
  const slotIndexes = new Set<number>(Object.values(cols))
  const columns: ProfileColumn[] = []
  header.forEach((item, index) => {
    const deriveOnly = slotIndexes.has(index)
    if (deriveOnly && canonicalFieldFor(item.id) === null) return
    const dictionary = item.dataDictionary ?? null
    // A slot column is read per transcript like its column value.
    const perTranscript = deriveOnly || COLUMNAR_TRANSCRIPT_FIELDS.has(item.id)
    columns.push({ index, name: item.id, dictionary, deriveOnly, perTranscript })
  })
  return columns
}

/**
 * One cell as stored text: for a transcript-specific column
 * (`selectedTranscript` set) the selected transcript's value, otherwise an
 * array is a list; a data-dictionary code is resolved to its label.
 */
/** A cell code's label from its column's data dictionary; other values as they are. */
function dictionaryLabel(dictionary: Record<string, unknown> | null): (code: unknown) => unknown {
  return (code) =>
    dictionary !== null &&
    code !== null &&
    typeof code !== 'object' &&
    Object.prototype.hasOwnProperty.call(dictionary, String(code))
      ? dictionary[String(code)]
      : code
}

export function columnarCellText(
  value: RawVariantRow[number],
  selectedTranscript: number | null,
  dictionary: Record<string, unknown> | null
): string | null {
  let selected: unknown = value
  if (Array.isArray(value) && selectedTranscript !== null) {
    selected = value[selectedTranscript] ?? value[0]
  }
  const label = dictionaryLabel(dictionary)
  return jsonValueText(Array.isArray(selected) ? selected.map(label) : label(selected))
}

export function createFieldMapper(
  dictionaries: DataDictionaries,
  columnIndices?: ColumnIndices,
  takeRecordBytes?: () => number,
  onSkip?: (reason: string) => void,
  columnCount?: number,
  profile?: { header: ColumnarHeaderItem[]; fields: FieldProfileResolver }
): FieldMapper {
  return new FieldMapper({
    dictionaries,
    columnIndices,
    takeRecordBytes,
    onSkip,
    columnCount,
    header: profile?.header,
    fields: profile?.fields
  })
}
