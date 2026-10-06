/**
 * Streaming XLSX writer for web exports (bounded memory).
 *
 * The desktop export builds the whole workbook in memory with SheetJS, which
 * is fine for one local user and not for a shared server. Here the data
 * sheet is generated row by row as SpreadsheetML (inline strings, no shared
 * string table) and deflated straight into the response through
 * zip-stream.ts. An optional info sheet is written after the data sheet, so
 * it can report the final row count.
 *
 * Excel caps a sheet at 1 048 576 rows; rows beyond `MAX_XLSX_DATA_ROWS` are
 * not written and the info sheet says the export was truncated.
 */
import { zipStream, type ZipEntrySource } from './zip-stream'

export type XlsxCell = string | number | null | undefined

export interface XlsxSheetSpec {
  name: string
  header: readonly string[]
  rows: AsyncIterable<readonly XlsxCell[]>
}

export interface XlsxStreamResult {
  /** Rows written to the data sheet (excluding the header). */
  rowCount: number
  truncated: boolean
}

/** Header row + data rows must fit Excel's 1 048 576-row sheet. */
export const MAX_XLSX_DATA_ROWS = 1_048_575
const MAX_CELL_CHARS = 32_767
const FLUSH_CHARS = 64 * 1024
// XML 1.0 forbids most C0 control characters even when escaped.
// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g

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

function cellXml(ref: string, value: XlsxCell, style: number): string {
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
  cells: readonly XlsxCell[],
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

async function* sheetXml(sheet: XlsxSheetSpec, result: XlsxStreamResult): AsyncGenerator<string> {
  const columns = sheet.header.map((_, i) => columnName(i))
  let buffer = SHEET_OPEN + rowXml(columns, 1, sheet.header, 1)
  for await (const cells of sheet.rows) {
    if (result.rowCount >= MAX_XLSX_DATA_ROWS) {
      result.truncated = true
      break
    }
    result.rowCount += 1
    buffer += rowXml(columns, result.rowCount + 1, cells)
    if (buffer.length >= FLUSH_CHARS) {
      yield buffer
      buffer = ''
    }
  }
  yield buffer + SHEET_CLOSE
}

async function* staticPart(xml: string): AsyncGenerator<string> {
  yield xml
}

function workbookParts(sheetNames: string[]): ZipEntrySource[] {
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
  // Style 0 = default, style 1 = bold (header row).
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
    { name: '[Content_Types].xml', content: () => staticPart(contentTypes) },
    { name: '_rels/.rels', content: () => staticPart(rootRels) },
    { name: 'xl/workbook.xml', content: () => staticPart(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', content: () => staticPart(workbookRels) },
    { name: 'xl/styles.xml', content: () => staticPart(styles) }
  ]
}

async function* infoSheetXml(rows: () => (string | number)[][]): AsyncGenerator<string> {
  const data = rows()
  const width = Math.max(1, ...data.map((r) => r.length))
  const columns = Array.from({ length: width }, (_, i) => columnName(i))
  let xml = SHEET_OPEN.replace(/<sheetViews>.*<\/sheetViews>/, '')
  data.forEach((cells, i) => {
    xml += rowXml(columns, i + 1, cells, i === 0 ? 1 : 0)
  })
  yield xml + SHEET_CLOSE
}

/**
 * Stream a workbook with one data sheet and an optional info sheet whose rows
 * are computed after the data sheet finished (`info(result)`).
 */
export function xlsxStream(
  sheet: XlsxSheetSpec,
  result: XlsxStreamResult,
  info?: { name: string; rows: (result: XlsxStreamResult) => (string | number)[][] }
): AsyncGenerator<Buffer> {
  const names = info === undefined ? [sheet.name] : [sheet.name, info.name]
  const entries: ZipEntrySource[] = [
    ...workbookParts(names),
    { name: 'xl/worksheets/sheet1.xml', content: () => sheetXml(sheet, result) }
  ]
  if (info !== undefined) {
    entries.push({
      name: 'xl/worksheets/sheet2.xml',
      content: () => infoSheetXml(() => info.rows(result))
    })
  }
  return zipStream(entries)
}
