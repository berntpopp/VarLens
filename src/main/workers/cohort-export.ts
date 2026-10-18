/**
 * Cohort XLSX export — runs inside the export worker.
 *
 * Previously this ran on the Electron main thread (audit 05 finding M-3): a
 * 100k-row cohort query, `aoa_to_sheet` and `XLSX.write` all blocked the
 * event loop with no progress or cancel. It now receives an open read-only
 * connection inside the worker; the main thread only relays progress and can
 * terminate the worker to cancel.
 */
import { openSync, writeSync, closeSync, rmSync } from 'node:fs'
import { deflateRawSync, crc32 } from 'node:zlib'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { CohortService } from '../database/cohort'
import { isCohortSummaryStale } from '../database/cohort-summary-case-removal'
import { CohortSummaryRefreshingError } from '../../shared/errors/cohort-summary-refreshing'
import type { CohortSearchParams } from '../../shared/types/cohort'
import type { ExportColumn } from './export-pipeline'
import { formatCellValue } from './export-renderer'
import { COHORT_ANNOTATION_EXPORT_COLUMNS } from '../../shared/config/export.config'
import { createCohortAnnotationBatchLookup } from '../database/annotation-export-lookup'

export const COHORT_EXPORT_HARD_LIMIT = 100_000

/** Cohort export column headers (shared with the PostgreSQL CSV export). */
export const COHORT_EXPORT_COLUMNS: readonly ExportColumn[] = [
  { key: 'chr', header: 'Chromosome' },
  { key: 'pos', header: 'Position' },
  { key: 'ref', header: 'Reference' },
  { key: 'alt', header: 'Alternate' },
  { key: 'gene_symbol', header: 'Gene' },
  { key: 'cdna', header: 'cDNA Change' },
  { key: 'aa_change', header: 'AA Change' },
  { key: 'consequence', header: 'Impact' },
  { key: 'func', header: 'Consequence' },
  { key: 'clinvar', header: 'ClinVar' },
  { key: 'gnomad_af', header: 'gnomAD AF' },
  { key: 'cadd_phred', header: 'CADD Score' },
  { key: 'carrier_count', header: 'Carriers' },
  { key: 'total_cases', header: 'Total Cases' },
  { key: 'cohort_frequency', header: 'Cohort Frequency' },
  { key: 'het_count', header: 'Heterozygous' },
  { key: 'hom_count', header: 'Homozygous' },
  { key: 'transcript', header: 'Transcript' },
  ...COHORT_ANNOTATION_EXPORT_COLUMNS
]

const PROGRESS_EVERY_ROWS = 5_000
const MAX_CELL_CHARS = 32_767

// XML 1.0 forbids most C0 control characters even when escaped.
// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g

function escapeXml(value: string): string {
  return value
    .replace(INVALID_XML_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function columnName(index: number): string {
  let name = ''
  let n = index + 1
  while (n > 0) {
    const rem = (n - 1) % 26
    name = String.fromCharCode(65 + rem) + name
    n = Math.floor((n - 1) / 26)
  }
  return name
}

function cellXml(ref: string, value: unknown, style: number): string {
  const s = style > 0 ? ` s="${style}"` : ''
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"${s}><v>${value}</v></c>`
  }
  const text = String(value)
  const clipped = text.length > MAX_CELL_CHARS ? text.slice(0, MAX_CELL_CHARS) : text
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(clipped)}</t></is></c>`
}

function rowXml(
  columns: string[],
  rowNumber: number,
  cells: readonly unknown[],
  style = 0
): string {
  let xml = `<row r="${rowNumber}">`
  for (let i = 0; i < cells.length; i += 1) {
    xml += cellXml(`${columns[i] ?? columnName(i)}${rowNumber}`, cells[i], style)
  }
  return `${xml}</row>`
}

const SHEET_OPEN =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" ' +
  'activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>'
const SHEET_CLOSE = '</sheetData></worksheet>'

interface CentralRecord {
  name: Buffer
  crc: number
  compressedSize: number
  size: number
  offset: number
}

function writeZipSync(
  filePath: string,
  entries: Array<{ name: string; chunks: () => Generator<string> | string[] }>
): void {
  const fd = openSync(filePath, 'w')
  let opened = true
  try {
    const records: CentralRecord[] = []
    let offset = 0
    const now = new Date()
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
    const day = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
    const stamp = { time, day }

    for (const entry of entries) {
      const entryStart = offset
      const nameBuf = Buffer.from(entry.name, 'utf8')
      const header = Buffer.alloc(30)
      header.writeUInt32LE(0x04034b50, 0)
      header.writeUInt16LE(20, 4)
      header.writeUInt16LE(0x0008 | 0x0800, 6)
      header.writeUInt16LE(8, 8)
      header.writeUInt16LE(stamp.time, 10)
      header.writeUInt16LE(stamp.day, 12)
      header.writeUInt16LE(nameBuf.length, 26)
      const localBuf = Buffer.concat([header, nameBuf])
      writeSync(fd, localBuf)
      offset += localBuf.length

      const chunks = Array.from(entry.chunks())
      const fullContent = Buffer.from(chunks.join(''), 'utf8')
      const crc = crc32(fullContent)
      const size = fullContent.length
      const comp = deflateRawSync(fullContent)
      const compressedSize = comp.length
      writeSync(fd, comp)
      offset += comp.length

      const desc = Buffer.alloc(16)
      desc.writeUInt32LE(0x08074b50, 0)
      desc.writeUInt32LE(crc >>> 0, 4)
      desc.writeUInt32LE(compressedSize, 8)
      desc.writeUInt32LE(size, 12)
      writeSync(fd, desc)
      offset += desc.length

      records.push({
        name: nameBuf,
        crc,
        compressedSize,
        size,
        offset: entryStart
      })
    }

    const centralStart = offset
    let centralSize = 0
    for (const r of records) {
      const ch = Buffer.alloc(46)
      ch.writeUInt32LE(0x02014b50, 0)
      ch.writeUInt16LE(20, 4)
      ch.writeUInt16LE(20, 6)
      ch.writeUInt16LE(0x0008 | 0x0800, 8)
      ch.writeUInt16LE(8, 10)
      ch.writeUInt16LE(stamp.time, 12)
      ch.writeUInt16LE(stamp.day, 14)
      ch.writeUInt32LE(r.crc >>> 0, 16)
      ch.writeUInt32LE(r.compressedSize, 20)
      ch.writeUInt32LE(r.size, 24)
      ch.writeUInt16LE(r.name.length, 28)
      ch.writeUInt32LE(r.offset, 42)
      const centralBuf = Buffer.concat([ch, r.name])
      writeSync(fd, centralBuf)
      offset += centralBuf.length
      centralSize += centralBuf.length
    }

    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(records.length, 8)
    end.writeUInt16LE(records.length, 10)
    end.writeUInt32LE(centralSize, 12)
    end.writeUInt32LE(centralStart, 16)
    writeSync(fd, end)
  } catch (err) {
    if (opened) {
      closeSync(fd)
      opened = false
      rmSync(filePath, { force: true })
    }
    throw err
  } finally {
    if (opened) closeSync(fd)
  }
}

function workbookParts(sheetNames: string[]): Array<{ name: string; chunks: () => string[] }> {
  const sheets = sheetNames.map((name, i) => ({ name: escapeXml(name.slice(0, 31)), id: i + 1 }))
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    sheets
      .map(
        (s) =>
          `<Override PartName="/xl/worksheets/sheet${s.id}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
      )
      .join('') +
    '</Types>'
  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>'
  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    sheets.map((s) => `<sheet name="${s.name}" sheetId="${s.id}" r:id="rId${s.id}"/>`).join('') +
    '</sheets></workbook>'
  const workbookRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets
      .map(
        (s) =>
          `<Relationship Id="rId${s.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${s.id}.xml"/>`
      )
      .join('') +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    '</Relationships>'
  const styles =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
    '</styleSheet>'
  return [
    { name: '[Content_Types].xml', chunks: () => [contentTypes] },
    { name: '_rels/.rels', chunks: () => [rootRels] },
    { name: 'xl/workbook.xml', chunks: () => [workbook] },
    { name: 'xl/_rels/workbook.xml.rels', chunks: () => [workbookRels] },
    { name: 'xl/styles.xml', chunks: () => [styles] }
  ]
}

function formatCohortCell(key: string, value: unknown): unknown {
  if (key === 'cohort_frequency' && typeof value === 'number') {
    return `${(value * 100).toFixed(1)}%`
  }
  return formatCellValue(key, value)
}

function buildCohortMetadata(
  params: CohortSearchParams,
  totalCases: number,
  exported: number
): unknown[][] {
  const has = (v: string | undefined): v is string => v !== undefined && v !== ''
  const hasList = (v: string[] | undefined): v is string[] => v !== undefined && v.length > 0
  return [
    ['Cohort Export Information'],
    ['Total Cases in Cohort', totalCases],
    ['Unique Variants Exported', exported],
    ['Export Date', new Date().toISOString()],
    [''],
    ['Active Filters'],
    ...(has(params.search_term) ? [['Search Term', params.search_term]] : []),
    ...(has(params.gene_symbol) ? [['Gene', params.gene_symbol]] : []),
    ...(hasList(params.consequences) ? [['Impact Levels', params.consequences.join(', ')]] : []),
    ...(hasList(params.funcs) ? [['Consequences', params.funcs.join(', ')]] : []),
    ...(hasList(params.clinvars) ? [['ClinVar', params.clinvars.join(', ')]] : []),
    ...(params.gnomad_af_max !== undefined ? [['Max gnomAD AF', params.gnomad_af_max]] : []),
    ...(params.cadd_min !== undefined ? [['Min CADD', params.cadd_min]] : []),
    ...(params.max_internal_af !== undefined
      ? [['Max Internal Frequency', `${(params.max_internal_af * 100).toFixed(1)}%`]]
      : []),
    ...(params.carrier_count_min !== undefined
      ? [['Min Carrier Count', params.carrier_count_min]]
      : []),
    ...(params.carrier_count_max !== undefined
      ? [['Max Carrier Cases', params.carrier_count_max]]
      : [])
  ]
}

export interface CohortExportResult {
  filePath: string
  rowCount: number
}

/**
 * Query the cohort (capped at {@link COHORT_EXPORT_HARD_LIMIT}) and write an
 * XLSX workbook incrementally. `onProgress(current, total)` fires after the query, every
 * {@link PROGRESS_EVERY_ROWS} rows while building, and once written.
 */
export function runCohortExport(
  db: DatabaseType,
  params: CohortSearchParams,
  outputFilePath: string,
  onProgress: (current: number, total: number) => void
): CohortExportResult & Promise<CohortExportResult> {
  // The summary is what gets exported: never write a file from a stale one.
  // The main process waited for a pending refresh before starting this job.
  if (isCohortSummaryStale(db)) throw new CohortSummaryRefreshingError()
  const cohortService = new CohortService(db)
  onProgress(0, 0)
  const variants = cohortService.getCohortVariants({
    ...params,
    limit: COHORT_EXPORT_HARD_LIMIT
  }).data
  const total = variants.length
  onProgress(0, total)

  const batchLookup = createCohortAnnotationBatchLookup(db)
  const columns = COHORT_EXPORT_COLUMNS.map((_, i) => columnName(i))
  const headers = COHORT_EXPORT_COLUMNS.map((col) => col.header)

  let writtenRows = 0
  function* generateCohortDataChunks(): Generator<string> {
    yield SHEET_OPEN + rowXml(columns, 1, headers, 1)
    let buffer = ''
    for (let i = 0; i < variants.length; i += 200) {
      const chunk = variants.slice(i, i + 200)
      const annotations = batchLookup(chunk)
      for (const variant of chunk) {
        writtenRows += 1
        const key =
          (variant as { id?: unknown }).id ??
          `${variant.chr}:${variant.pos}:${variant.ref}:${variant.alt}:${variant.genome_build}`
        const ann = annotations.get(key)
        const row: Record<string, unknown> = { ...variant, ...ann }
        const cells = COHORT_EXPORT_COLUMNS.map((col) => formatCohortCell(col.key, row[col.key]))
        buffer += rowXml(columns, writtenRows + 1, cells)
        if (writtenRows % PROGRESS_EVERY_ROWS === 0) {
          onProgress(writtenRows, total)
        }
      }
      if (buffer.length >= 65536) {
        yield buffer
        buffer = ''
      }
    }
    yield buffer + SHEET_CLOSE
  }

  const summary = cohortService.getCohortSummary()
  const metadataRows = buildCohortMetadata(params, summary.total_cases, total)
  function* generateMetaChunks(): Generator<string> {
    const width = Math.max(1, ...metadataRows.map((r) => r.length))
    const metaCols = Array.from({ length: width }, (_, i) => columnName(i))
    let xml = SHEET_OPEN.replace(/<sheetViews>.*<\/sheetViews>/, '')
    metadataRows.forEach((cells, i) => {
      xml += rowXml(metaCols, i + 1, cells, i === 0 ? 1 : 0)
    })
    yield xml + SHEET_CLOSE
  }

  writeZipSync(outputFilePath, [
    ...workbookParts(['Cohort Variants', 'Export Info']),
    { name: 'xl/worksheets/sheet1.xml', chunks: generateCohortDataChunks },
    { name: 'xl/worksheets/sheet2.xml', chunks: generateMetaChunks }
  ])

  onProgress(total, total)
  const result: CohortExportResult = { filePath: outputFilePath, rowCount: total }
  const res = Promise.resolve(result)
  Object.assign(res, result)
  return res as CohortExportResult & Promise<CohortExportResult>
}
