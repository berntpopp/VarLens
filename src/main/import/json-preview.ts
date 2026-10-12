/**
 * JSON import preview (spec §16): the fields of the first variants of a
 * columnar / object / simple export with their type, fill rate and a few
 * short sample values, for the import wizard's field table. Values are read
 * the way the importer stores them (dictionary codes resolved, lists joined).
 */
import type { Readable } from 'node:stream'

import {
  COLUMNAR_SLOT_COLUMN,
  OBJECT_FORMAT_COLUMNS,
  VARVIS_SNV_COLUMN_TYPES
} from '../../shared/config/import-fields.config'
import type { ImportFieldPreview, JsonFieldPreviewResult } from '../../shared/types/import'
import { isJsonNumberText } from '../../shared/filters/info-value'
import { jsonValueText } from '../../shared/utils/import-field-profile'
import { parseHeader } from '../workers/import-mapper-pipeline'
import { createDataPipeline } from './format-detection'
import { columnarCellText, type ColumnarHeaderItem } from './transforms/FieldMapper'
import type { ColumnIndices } from './config/fieldMapping'
import type { RawVariantRow } from './types'

export const JSON_PREVIEW_VARIANTS = 200
const MAX_SAMPLES = 3
const MAX_SAMPLE_CHARS = 40

interface FieldStats {
  name: string
  description?: string
  column: string | null
  headerType: string
  filled: number
  allNumeric: boolean
  samples: string[]
}

class FieldCollector {
  private readonly stats = new Map<string, FieldStats>()

  declare(name: string, column: string | null, headerType = '', description?: string): FieldStats {
    let entry = this.stats.get(name)
    if (entry === undefined) {
      entry = { name, description, column, headerType, filled: 0, allNumeric: true, samples: [] }
      this.stats.set(name, entry)
    }
    return entry
  }

  add(entry: FieldStats, text: string | null): void {
    if (text === null) return
    entry.filled += 1
    entry.allNumeric &&= isJsonNumberText(text)
    if (entry.samples.length < MAX_SAMPLES && !entry.samples.includes(text)) {
      entry.samples.push(
        text.length > MAX_SAMPLE_CHARS ? `${text.slice(0, MAX_SAMPLE_CHARS)}…` : text
      )
    }
  }

  result(scanned: number): ImportFieldPreview[] {
    return [...this.stats.values()].map((entry) => ({
      origin: 'JSON',
      name: entry.name,
      column: entry.column,
      type: fieldType(entry),
      fillRate: scanned === 0 ? 0 : entry.filled / scanned,
      samples: entry.samples,
      ...(entry.description !== undefined ? { description: entry.description } : {})
    }))
  }
}

function fieldType(entry: FieldStats): string {
  if (entry.filled > 0) return entry.allNumeric ? 'number' : 'text'
  const known = VARVIS_SNV_COLUMN_TYPES[entry.name]
  if (known !== undefined) return known
  return entry.headerType === 'dictionary' ? 'text' : entry.headerType
}

export async function getJsonFieldPreview(
  filePath: string,
  limit = JSON_PREVIEW_VARIANTS
): Promise<JsonFieldPreviewResult> {
  const { formatInfo, stream } = await createDataPipeline(filePath)
  const collector = new FieldCollector()
  let readRow: (value: unknown) => void
  if (formatInfo.format === 'columnar') {
    const wrapped = formatInfo.wrapped !== false
    const headerPath = wrapped ? `${formatInfo.caseKey}.header` : 'header'
    const { headerItems, columnIndices } = await parseHeader(filePath, headerPath)
    readRow = columnarRowReader(collector, headerItems, columnIndices)
  } else {
    readRow = (value) => {
      if (value === null || typeof value !== 'object') return
      for (const [name, field] of Object.entries(value)) {
        const column = Object.prototype.hasOwnProperty.call(OBJECT_FORMAT_COLUMNS, name)
          ? OBJECT_FORMAT_COLUMNS[name]
          : null
        collector.add(collector.declare(name, column), jsonValueText(field))
      }
    }
  }
  const scanned = await readFirst(stream, limit, readRow)
  return { format: formatInfo.format, variantsScanned: scanned, fields: collector.result(scanned) }
}

function columnarRowReader(
  collector: FieldCollector,
  header: ColumnarHeaderItem[],
  cols: ColumnIndices
): (value: unknown) => void {
  const slotByIndex = new Map(Object.entries(cols).map(([slot, index]) => [index, slot]))
  const entries = header.map((item, index) => {
    const slot = slotByIndex.get(index) as keyof typeof COLUMNAR_SLOT_COLUMN | undefined
    const column = slot === undefined ? null : COLUMNAR_SLOT_COLUMN[slot]
    return collector.declare(item.id, column, item.type ?? '', item.label)
  })
  return (value) => {
    if (!Array.isArray(value)) return
    const row = value as RawVariantRow
    const transcripts = row[cols.TRANSCRIPT]
    const transcriptCount = Array.isArray(transcripts) ? transcripts.length : 1
    const selected = Number(row[cols.SELECTED_TRANSCRIPT] ?? 0) || 0
    header.forEach((item, index) => {
      const text = columnarCellText(
        row[index],
        selected,
        transcriptCount,
        item.dataDictionary ?? null
      )
      collector.add(entries[index], text)
    })
  }
}

async function readFirst(
  stream: Readable,
  limit: number,
  readRow: (value: unknown) => void
): Promise<number> {
  let scanned = 0
  try {
    for await (const chunk of stream) {
      if (scanned >= limit) break
      readRow((chunk as { value: unknown }).value)
      scanned += 1
    }
  } finally {
    stream.destroy()
  }
  return scanned
}
