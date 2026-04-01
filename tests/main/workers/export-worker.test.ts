// @vitest-environment node
/**
 * Tests for the export worker helpers.
 *
 * export-worker.ts is a worker_threads entry point, so we cannot import and run
 * it directly (parentPort would be null).  Instead we test the two exported
 * pure helpers — formatCellValue() and csvEscape() — plus the full export
 * pipeline by replicating the same logic against a real file-based SQLite DB
 * and a temp output file, exercising both the CSV and XLSX paths.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3-multiple-ciphers'
import * as XLSX from 'xlsx'
import { formatCellValue, csvEscape } from '../../../src/main/workers/export-worker'
import { DatabaseService } from '../../../src/main/database/DatabaseService'
import type { ExportMainMessage } from '../../../src/shared/types/export-worker'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Insert a minimal variant row into the given DatabaseService */
function insertVariant(
  svc: DatabaseService,
  caseId: number,
  overrides: Partial<{
    chr: string
    pos: number
    ref: string
    alt: string
    gene_symbol: string | null
    consequence: string | null
    func: string | null
    clinvar: string | null
    gnomad_af: number | null
    cadd: number | null
    gt_num: string | null
    transcript: string | null
    cdna: string | null
    aa_change: string | null
    qual: number | null
    hpo_sim_score: number | null
    moi: string | null
  }> = {}
): void {
  const v = {
    chr: '1',
    pos: 100,
    ref: 'A',
    alt: 'G',
    gene_symbol: null,
    consequence: null,
    func: null,
    clinvar: null,
    gnomad_af: null,
    cadd: null,
    gt_num: '0/1',
    transcript: null,
    cdna: null,
    aa_change: null,
    qual: null,
    hpo_sim_score: null,
    moi: null,
    ...overrides
  }
  svc.database
    .prepare(
      `INSERT INTO variants
        (case_id, chr, pos, ref, alt, gene_symbol, consequence, func, clinvar,
         gnomad_af, cadd, gt_num, transcript, cdna, aa_change, qual, hpo_sim_score, moi)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      caseId,
      v.chr,
      v.pos,
      v.ref,
      v.alt,
      v.gene_symbol,
      v.consequence,
      v.func,
      v.clinvar,
      v.gnomad_af,
      v.cadd,
      v.gt_num,
      v.transcript,
      v.cdna,
      v.aa_change,
      v.qual,
      v.hpo_sim_score,
      v.moi
    )
}

/** Columns the worker exports — keep in sync with EXPORT_COLUMNS in export-worker.ts */
const EXPORT_COLUMNS = [
  { key: 'chr', header: 'Chromosome' },
  { key: 'pos', header: 'Position' },
  { key: 'ref', header: 'Reference' },
  { key: 'alt', header: 'Alternate' },
  { key: 'gt_num', header: 'Genotype' },
  { key: 'gene_symbol', header: 'Gene' },
  { key: 'func', header: 'Function' },
  { key: 'consequence', header: 'Consequence' },
  { key: 'transcript', header: 'Transcript' },
  { key: 'cdna', header: 'cDNA' },
  { key: 'aa_change', header: 'AA Change' },
  { key: 'gnomad_af', header: 'gnomAD AF' },
  { key: 'cadd', header: 'CADD' },
  { key: 'qual', header: 'Quality' },
  { key: 'clinvar', header: 'ClinVar' },
  { key: 'hpo_sim_score', header: 'HPO Similarity' },
  { key: 'moi', header: 'MOI' }
]

/** Build the SQL the worker would receive (selecting all export columns for a case) */
function buildExportSql(caseId: number): { sql: string; params: readonly unknown[] } {
  const cols = EXPORT_COLUMNS.map((c) => c.key).join(', ')
  const sql = `SELECT ${cols} FROM variants WHERE case_id = ? ORDER BY chr, pos`
  return { sql, params: [caseId] }
}

/** Helper to clean up temp files */
function cleanupFiles(...paths: string[]): void {
  for (const p of paths) {
    try {
      if (existsSync(p)) unlinkSync(p)
    } catch {
      // best effort
    }
  }
}

/**
 * Replicate the CSV pipeline from export-worker.ts.
 * Uses in-memory accumulation + writeFileSync so the file is fully written before returning.
 * (The real worker uses createWriteStream for memory efficiency, but the logic is identical.)
 */
function runCsvExport(
  dbPath: string,
  sql: string,
  params: readonly unknown[],
  outputPath: string
): number {
  const db = new Database(dbPath, { readonly: true })
  db.pragma('journal_mode = WAL')
  try {
    const stmt = db.prepare(sql)
    const iterator = stmt.iterate(...params) as IterableIterator<Record<string, unknown>>
    const lines: string[] = []
    const headerRow = EXPORT_COLUMNS.map((col) => csvEscape(col.header)).join(',')
    lines.push(headerRow)
    let rowCount = 0
    for (const row of iterator) {
      const cells = EXPORT_COLUMNS.map((col) => csvEscape(formatCellValue(col.key, row[col.key])))
      lines.push(cells.join(','))
      rowCount++
    }
    writeFileSync(outputPath, lines.join('\r\n') + '\r\n', 'utf8')
    return rowCount
  } finally {
    db.close()
  }
}

/**
 * Read an XLSX file from disk without relying on XLSX.readFile (which needs _fs in ESM context).
 * Uses readFileSync + XLSX.read instead.
 */
function readXlsxFile(filePath: string): XLSX.WorkBook {
  const buf = readFileSync(filePath)
  return XLSX.read(buf, { type: 'buffer' })
}

/** Replicate the XLSX pipeline from export-worker.ts */
function runXlsxExport(
  dbPath: string,
  sql: string,
  params: readonly unknown[],
  outputPath: string,
  caseName: string,
  filterSummary: ExportMainMessage['filterSummary']
): number {
  const db = new Database(dbPath, { readonly: true })
  db.pragma('journal_mode = WAL')
  try {
    const stmt = db.prepare(sql)
    const iterator = stmt.iterate(...params) as IterableIterator<Record<string, unknown>>
    const headers = EXPORT_COLUMNS.map((col) => col.header)
    const rows: (string | number | null)[][] = []
    let i = 0
    for (const variant of iterator) {
      rows.push(EXPORT_COLUMNS.map((col) => formatCellValue(col.key, variant[col.key])))
      i++
    }
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    ws['!cols'] = EXPORT_COLUMNS.map((col) => ({ wch: col.key === 'aa_change' ? 20 : 15 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Variants')

    const metaData: (string | number)[][] = [
      ['Export Information'],
      ['Case Name', caseName],
      ['Total Variants', i],
      ['Export Date', new Date().toISOString()],
      [''],
      ['Active Filters'],
      ...(filterSummary.gene_symbol !== undefined && filterSummary.gene_symbol !== ''
        ? [['Gene', filterSummary.gene_symbol]]
        : []),
      ...(filterSummary.consequences !== undefined && filterSummary.consequences.length > 0
        ? [['Consequences', filterSummary.consequences.join(', ')]]
        : []),
      ...(filterSummary.gnomad_af_max !== undefined
        ? [['Max gnomAD AF', filterSummary.gnomad_af_max]]
        : [])
    ]
    const metaWs = XLSX.utils.aoa_to_sheet(metaData)
    XLSX.utils.book_append_sheet(wb, metaWs, 'Export Info')
    // Use XLSX.write + writeFileSync because XLSX.writeFile requires _fs to be set in ESM context
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    writeFileSync(outputPath, buf)
    return i
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------------------
// Unit tests — formatCellValue
// ---------------------------------------------------------------------------

describe('formatCellValue', () => {
  it('returns empty string for null value', () => {
    expect(formatCellValue('chr', null)).toBe('')
  })

  it('returns empty string for undefined value', () => {
    expect(formatCellValue('chr', undefined)).toBe('')
  })

  it('formats gnomad_af as exponential with 2 decimal places', () => {
    expect(formatCellValue('gnomad_af', 0.0001234)).toBe('1.23e-4')
  })

  it('formats cadd as fixed with 2 decimal places', () => {
    expect(formatCellValue('cadd', 23.456)).toBe('23.46')
  })

  it('formats hpo_sim_score as fixed with 4 decimal places', () => {
    expect(formatCellValue('hpo_sim_score', 0.87654321)).toBe('0.8765')
  })

  it('passes through string values unchanged', () => {
    expect(formatCellValue('chr', '1')).toBe('1')
    expect(formatCellValue('gene_symbol', 'BRCA1')).toBe('BRCA1')
  })

  it('passes through integer values unchanged', () => {
    expect(formatCellValue('pos', 12345)).toBe(12345)
  })

  it('does not apply numeric formatting to non-special numeric columns', () => {
    expect(formatCellValue('pos', 999)).toBe(999)
    expect(formatCellValue('qual', 99)).toBe(99)
  })
})

// ---------------------------------------------------------------------------
// Unit tests — csvEscape
// ---------------------------------------------------------------------------

describe('csvEscape', () => {
  it('returns empty string for null', () => {
    expect(csvEscape(null)).toBe('')
  })

  it('returns plain value when no special characters', () => {
    expect(csvEscape('hello')).toBe('hello')
    expect(csvEscape('BRCA1')).toBe('BRCA1')
    expect(csvEscape(42)).toBe('42')
  })

  it('wraps value in double-quotes when it contains a comma', () => {
    expect(csvEscape('a,b')).toBe('"a,b"')
  })

  it('wraps value in double-quotes when it contains a double-quote and escapes it', () => {
    expect(csvEscape('say "hello"')).toBe('"say ""hello"""')
  })

  it('wraps value in double-quotes when it contains a newline', () => {
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"')
  })

  it('wraps value in double-quotes when it contains a carriage return', () => {
    expect(csvEscape('line1\r\nline2')).toBe('"line1\r\nline2"')
  })

  it('handles a value with both commas and quotes', () => {
    expect(csvEscape('He said, "hi"')).toBe('"He said, ""hi"""')
  })

  it('handles numeric zero', () => {
    expect(csvEscape(0)).toBe('0')
  })
})

// ---------------------------------------------------------------------------
// Integration tests — CSV export pipeline
// ---------------------------------------------------------------------------

describe('CSV export pipeline', () => {
  let svc: DatabaseService
  let caseId: number
  let dbPath: string
  let outputPath: string

  beforeEach(() => {
    // Use a file-based DB so the export runner can open it read-only
    dbPath = join(tmpdir(), `varlens-export-test-${randomUUID()}.db`)
    outputPath = join(tmpdir(), `varlens-export-test-${randomUUID()}.csv`)
    svc = new DatabaseService(dbPath)
    caseId = svc.cases.createCase('Test Case', '/test/path.vcf', 0)
  })

  afterEach(() => {
    svc.close()
    cleanupFiles(dbPath, outputPath, dbPath + '-wal', dbPath + '-shm')
  })

  it('produces a valid CSV file with correct header row', () => {
    insertVariant(svc, caseId, { chr: '1', pos: 100, ref: 'A', alt: 'G' })

    const { sql, params } = buildExportSql(caseId)
    runCsvExport(dbPath, sql, params, outputPath)

    const content = readFileSync(outputPath, 'utf8')
    const lines = content.split('\r\n').filter((l) => l.length > 0)

    // First line is the header
    const expectedHeader = EXPORT_COLUMNS.map((c) => c.header).join(',')
    expect(lines[0]).toBe(expectedHeader)
  })

  it('produces one data row per variant', () => {
    insertVariant(svc, caseId, { chr: '1', pos: 100 })
    insertVariant(svc, caseId, { chr: '2', pos: 200 })
    insertVariant(svc, caseId, { chr: '3', pos: 300 })

    const { sql, params } = buildExportSql(caseId)
    const rowCount = runCsvExport(dbPath, sql, params, outputPath)

    expect(rowCount).toBe(3)

    const content = readFileSync(outputPath, 'utf8')
    const lines = content.split('\r\n').filter((l) => l.length > 0)
    // header + 3 data rows
    expect(lines).toHaveLength(4)
  })

  it('correctly formats gnomad_af in exponential notation', () => {
    insertVariant(svc, caseId, { chr: '1', pos: 100, gnomad_af: 0.0001 })

    const { sql, params } = buildExportSql(caseId)
    runCsvExport(dbPath, sql, params, outputPath)

    const content = readFileSync(outputPath, 'utf8')
    // gnomAD AF column value should use exponential notation
    expect(content).toContain('1.00e-4')
  })

  it('correctly formats cadd with 2 decimal places', () => {
    insertVariant(svc, caseId, { chr: '1', pos: 100, cadd: 25.123 })

    const { sql, params } = buildExportSql(caseId)
    runCsvExport(dbPath, sql, params, outputPath)

    const content = readFileSync(outputPath, 'utf8')
    expect(content).toContain('25.12')
  })

  it('CSV-escapes values that contain commas', () => {
    // aa_change sometimes contains commas (e.g. p.Arg,Gly)
    insertVariant(svc, caseId, { chr: '1', pos: 100, aa_change: 'p.Arg,Gly' })

    const { sql, params } = buildExportSql(caseId)
    runCsvExport(dbPath, sql, params, outputPath)

    const content = readFileSync(outputPath, 'utf8')
    // Value should be quoted
    expect(content).toContain('"p.Arg,Gly"')
  })

  it('produces an empty CSV (header only) when no variants exist', () => {
    const { sql, params } = buildExportSql(caseId)
    const rowCount = runCsvExport(dbPath, sql, params, outputPath)

    expect(rowCount).toBe(0)

    const content = readFileSync(outputPath, 'utf8')
    const lines = content.split('\r\n').filter((l) => l.length > 0)
    expect(lines).toHaveLength(1) // header only
  })

  it('returns correct row count', () => {
    insertVariant(svc, caseId, { chr: '1', pos: 1 })
    insertVariant(svc, caseId, { chr: '1', pos: 2 })

    const { sql, params } = buildExportSql(caseId)
    const rowCount = runCsvExport(dbPath, sql, params, outputPath)

    expect(rowCount).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Integration tests — XLSX export pipeline
// ---------------------------------------------------------------------------

describe('XLSX export pipeline', () => {
  let svc: DatabaseService
  let caseId: number
  let dbPath: string
  let outputPath: string

  beforeEach(() => {
    dbPath = join(tmpdir(), `varlens-export-test-${randomUUID()}.db`)
    outputPath = join(tmpdir(), `varlens-export-test-${randomUUID()}.xlsx`)
    svc = new DatabaseService(dbPath)
    caseId = svc.cases.createCase('Test Case', '/test/path.vcf', 0)
  })

  afterEach(() => {
    svc.close()
    cleanupFiles(dbPath, outputPath, dbPath + '-wal', dbPath + '-shm')
  })

  it('produces a valid XLSX file with Variants sheet', () => {
    insertVariant(svc, caseId, { chr: '1', pos: 100, gene_symbol: 'BRCA1' })

    const { sql, params } = buildExportSql(caseId)
    const rowCount = runXlsxExport(dbPath, sql, params, outputPath, 'Test Case', {})

    expect(rowCount).toBe(1)

    const wb = readXlsxFile(outputPath)
    expect(wb.SheetNames).toContain('Variants')
  })

  it('Variants sheet has correct headers in first row', () => {
    insertVariant(svc, caseId, { chr: '1', pos: 100 })

    const { sql, params } = buildExportSql(caseId)
    runXlsxExport(dbPath, sql, params, outputPath, 'Test Case', {})

    const wb = readXlsxFile(outputPath)
    const ws = wb.Sheets['Variants']
    const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 }) as string[][]

    const firstRow = data[0]
    expect(firstRow).toEqual(EXPORT_COLUMNS.map((c) => c.header))
  })

  it('includes all data rows', () => {
    insertVariant(svc, caseId, { chr: '1', pos: 100, gene_symbol: 'BRCA1' })
    insertVariant(svc, caseId, { chr: '2', pos: 200, gene_symbol: 'TP53' })

    const { sql, params } = buildExportSql(caseId)
    const rowCount = runXlsxExport(dbPath, sql, params, outputPath, 'Test Case', {})

    expect(rowCount).toBe(2)

    const wb = readXlsxFile(outputPath)
    const ws = wb.Sheets['Variants']
    const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 }) as string[][]
    // header + 2 data rows
    expect(data).toHaveLength(3)
  })

  it('includes Export Info metadata sheet', () => {
    insertVariant(svc, caseId, { chr: '1', pos: 100 })

    const { sql, params } = buildExportSql(caseId)
    runXlsxExport(dbPath, sql, params, outputPath, 'My Case', {})

    const wb = readXlsxFile(outputPath)
    expect(wb.SheetNames).toContain('Export Info')

    const metaWs = wb.Sheets['Export Info']
    const metaData = XLSX.utils.sheet_to_json<string[]>(metaWs, { header: 1 }) as string[][]
    // Should contain case name
    const hasCase = metaData.some((row) => row.includes('My Case'))
    expect(hasCase).toBe(true)
  })

  it('metadata sheet includes active filter summary', () => {
    insertVariant(svc, caseId, { chr: '1', pos: 100 })

    const { sql, params } = buildExportSql(caseId)
    runXlsxExport(dbPath, sql, params, outputPath, 'Test Case', {
      gene_symbol: 'BRCA1',
      consequences: ['HIGH'],
      gnomad_af_max: 0.01
    })

    const wb = readXlsxFile(outputPath)
    const metaWs = wb.Sheets['Export Info']
    const metaData = XLSX.utils.sheet_to_json<string[]>(metaWs, { header: 1 }) as string[][]

    const flat = metaData.flat()
    expect(flat).toContain('BRCA1')
    expect(flat).toContain('HIGH')
    expect(flat).toContain(0.01)
  })

  it('correctly formats gnomad_af in XLSX cells', () => {
    insertVariant(svc, caseId, { chr: '1', pos: 100, gnomad_af: 0.00015 })

    const { sql, params } = buildExportSql(caseId)
    runXlsxExport(dbPath, sql, params, outputPath, 'Test Case', {})

    const wb = readXlsxFile(outputPath)
    const ws = wb.Sheets['Variants']
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws) as Record<string, unknown>[]

    expect(data[0]['gnomAD AF']).toBe('1.50e-4')
  })

  it('produces a valid XLSX with no variants (header only)', () => {
    const { sql, params } = buildExportSql(caseId)
    const rowCount = runXlsxExport(dbPath, sql, params, outputPath, 'Empty Case', {})

    expect(rowCount).toBe(0)

    const wb = readXlsxFile(outputPath)
    const ws = wb.Sheets['Variants']
    const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 }) as string[][]
    // header row only
    expect(data).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// format routing — type-level check
// ---------------------------------------------------------------------------

describe('ExportMainMessage format field', () => {
  it('accepts xlsx format', () => {
    const msg: ExportMainMessage = {
      type: 'start',
      dbPath: '/tmp/test.db',
      compiledSql: 'SELECT 1',
      compiledParams: [],
      outputFilePath: '/tmp/out.xlsx',
      caseName: 'Test',
      filterSummary: {},
      format: 'xlsx'
    }
    expect(msg.format).toBe('xlsx')
  })

  it('accepts csv format', () => {
    const msg: ExportMainMessage = {
      type: 'start',
      dbPath: '/tmp/test.db',
      compiledSql: 'SELECT 1',
      compiledParams: [],
      outputFilePath: '/tmp/out.csv',
      caseName: 'Test',
      filterSummary: {},
      format: 'csv'
    }
    expect(msg.format).toBe('csv')
  })
})
