// @vitest-environment node
/**
 * Tests for the extracted export pipeline module.
 *
 * Tests the core export orchestration (CSV streaming, XLSX worksheet building,
 * progress reporting, metadata sheet generation) using a real in-memory SQLite
 * database, without any worker_threads dependencies.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import * as XLSX from 'xlsx'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import {
  runExportPipeline,
  buildMetadataSheet,
  EXPORT_COLUMNS
} from '../../../src/main/workers/export-pipeline'
import type { ExportPipelineParams } from '../../../src/main/workers/export-pipeline'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string

function createTestDb(): DatabaseType {
  // Use a file-based DB since the export pipeline uses iterate() which needs
  // the DB to remain open and accessible
  const dbPath = join(tmpDir, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
  const db = new Database(dbPath)
  initializeSchema(db)
  runMigrations(db)
  return db
}

function insertVariant(
  db: DatabaseType,
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
  db.prepare(
    `INSERT INTO variants
      (case_id, chr, pos, ref, alt, gene_symbol, consequence, func, clinvar,
       gnomad_af, cadd, gt_num, transcript, cdna, aa_change, qual, hpo_sim_score, moi)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
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

function createCase(db: DatabaseType, name: string): number {
  const result = db
    .prepare(
      `INSERT INTO cases (name, file_path, file_size, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(name, '/test/path.vcf', 0, Date.now())
  return Number(result.lastInsertRowid)
}

function buildExportSql(caseId: number): { sql: string; params: readonly unknown[] } {
  const cols = EXPORT_COLUMNS.map((c) => c.key).join(', ')
  const sql = `SELECT ${cols} FROM variants WHERE case_id = ? ORDER BY chr, pos`
  return { sql, params: [caseId] }
}

function makeOutputPath(ext: string): string {
  return join(tmpDir, `export-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`)
}

function readXlsxFile(filePath: string): XLSX.WorkBook {
  const buf = readFileSync(filePath)
  return XLSX.read(buf, { type: 'buffer' })
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'varlens-export-pipeline-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// buildMetadataSheet (unit)
// ---------------------------------------------------------------------------

describe('buildMetadataSheet', () => {
  it('includes case name and total variants', () => {
    const sheet = buildMetadataSheet('My Case', 42, {})
    const flat = sheet.flat()
    expect(flat).toContain('My Case')
    expect(flat).toContain(42)
  })

  it('includes gene filter when provided', () => {
    const sheet = buildMetadataSheet('Case', 0, { gene_symbol: 'BRCA1' })
    const flat = sheet.flat()
    expect(flat).toContain('Gene')
    expect(flat).toContain('BRCA1')
  })

  it('includes consequences filter when provided', () => {
    const sheet = buildMetadataSheet('Case', 0, { consequences: ['HIGH', 'MODERATE'] })
    const flat = sheet.flat()
    expect(flat).toContain('Consequences')
    expect(flat).toContain('HIGH, MODERATE')
  })

  it('includes funcs filter when provided', () => {
    const sheet = buildMetadataSheet('Case', 0, { funcs: ['missense_variant'] })
    const flat = sheet.flat()
    expect(flat).toContain('Functions')
    expect(flat).toContain('missense_variant')
  })

  it('includes clinvars filter when provided', () => {
    const sheet = buildMetadataSheet('Case', 0, { clinvars: ['Pathogenic'] })
    const flat = sheet.flat()
    expect(flat).toContain('ClinVar')
    expect(flat).toContain('Pathogenic')
  })

  it('includes gnomad_af_max filter when provided', () => {
    const sheet = buildMetadataSheet('Case', 0, { gnomad_af_max: 0.01 })
    const flat = sheet.flat()
    expect(flat).toContain('Max gnomAD AF')
    expect(flat).toContain(0.01)
  })

  it('includes cadd_min filter when provided', () => {
    const sheet = buildMetadataSheet('Case', 0, { cadd_min: 20 })
    const flat = sheet.flat()
    expect(flat).toContain('Min CADD')
    expect(flat).toContain(20)
  })

  it('omits filter rows when summary is empty', () => {
    const sheet = buildMetadataSheet('Case', 0, {})
    const flat = sheet.flat()
    expect(flat).not.toContain('Gene')
    expect(flat).not.toContain('Consequences')
    expect(flat).not.toContain('Max gnomAD AF')
  })

  it('omits gene filter when gene_symbol is empty string', () => {
    const sheet = buildMetadataSheet('Case', 0, { gene_symbol: '' })
    const flat = sheet.flat()
    expect(flat).not.toContain('Gene')
  })
})

// ---------------------------------------------------------------------------
// CSV export pipeline
// ---------------------------------------------------------------------------

describe('runExportPipeline — CSV', () => {
  let db: DatabaseType
  let caseId: number

  beforeEach(() => {
    db = createTestDb()
    caseId = createCase(db, 'Test Case')
  })

  afterEach(() => {
    db.close()
  })

  function makeCsvParams(overrides?: Partial<ExportPipelineParams>): ExportPipelineParams {
    const { sql, params } = buildExportSql(caseId)
    return {
      db,
      compiledSql: sql,
      compiledParams: params,
      outputFilePath: makeOutputPath('csv'),
      format: 'csv',
      caseName: 'Test Case',
      filterSummary: {},
      ...overrides
    }
  }

  it('produces a valid CSV file with correct header row', async () => {
    insertVariant(db, caseId, { chr: '1', pos: 100, ref: 'A', alt: 'G' })
    const params = makeCsvParams()
    await runExportPipeline(params)

    const content = readFileSync(params.outputFilePath, 'utf8')
    const lines = content.split('\r\n').filter((l) => l.length > 0)
    const expectedHeader = EXPORT_COLUMNS.map((c) => c.header).join(',')
    expect(lines[0]).toBe(expectedHeader)
  })

  it('produces one data row per variant', async () => {
    insertVariant(db, caseId, { chr: '1', pos: 100 })
    insertVariant(db, caseId, { chr: '2', pos: 200 })
    insertVariant(db, caseId, { chr: '3', pos: 300 })

    const params = makeCsvParams()
    const result = await runExportPipeline(params)

    expect(result.rowCount).toBe(3)

    const content = readFileSync(params.outputFilePath, 'utf8')
    const lines = content.split('\r\n').filter((l) => l.length > 0)
    expect(lines).toHaveLength(4) // header + 3 data rows
  })

  it('returns correct result shape', async () => {
    insertVariant(db, caseId, { chr: '1', pos: 100 })
    const params = makeCsvParams()
    const result = await runExportPipeline(params)

    expect(result.rowCount).toBe(1)
    expect(result.filePath).toBe(params.outputFilePath)
  })

  it('correctly formats gnomad_af in exponential notation', async () => {
    insertVariant(db, caseId, { chr: '1', pos: 100, gnomad_af: 0.0001 })
    const params = makeCsvParams()
    await runExportPipeline(params)

    const content = readFileSync(params.outputFilePath, 'utf8')
    expect(content).toContain('1.00e-4')
  })

  it('correctly formats cadd with 2 decimal places', async () => {
    insertVariant(db, caseId, { chr: '1', pos: 100, cadd: 25.123 })
    const params = makeCsvParams()
    await runExportPipeline(params)

    const content = readFileSync(params.outputFilePath, 'utf8')
    expect(content).toContain('25.12')
  })

  it('CSV-escapes values that contain commas', async () => {
    insertVariant(db, caseId, { chr: '1', pos: 100, aa_change: 'p.Arg,Gly' })
    const params = makeCsvParams()
    await runExportPipeline(params)

    const content = readFileSync(params.outputFilePath, 'utf8')
    expect(content).toContain('"p.Arg,Gly"')
  })

  it('produces header-only CSV when no variants exist', async () => {
    const params = makeCsvParams()
    const result = await runExportPipeline(params)

    expect(result.rowCount).toBe(0)

    const content = readFileSync(params.outputFilePath, 'utf8')
    const lines = content.split('\r\n').filter((l) => l.length > 0)
    expect(lines).toHaveLength(1) // header only
  })

  it('calls onProgress callback', async () => {
    insertVariant(db, caseId, { chr: '1', pos: 100 })
    const onProgress = vi.fn()
    const params = makeCsvParams({ onProgress })
    await runExportPipeline(params)

    // At minimum, the initial progress(0, 0) is called
    expect(onProgress).toHaveBeenCalledWith(0, 0)
  })
})

// ---------------------------------------------------------------------------
// XLSX export pipeline
// ---------------------------------------------------------------------------

describe('runExportPipeline — XLSX', () => {
  let db: DatabaseType
  let caseId: number

  beforeEach(() => {
    db = createTestDb()
    caseId = createCase(db, 'Test Case')
  })

  afterEach(() => {
    db.close()
  })

  function makeXlsxParams(overrides?: Partial<ExportPipelineParams>): ExportPipelineParams {
    const { sql, params } = buildExportSql(caseId)
    return {
      db,
      compiledSql: sql,
      compiledParams: params,
      outputFilePath: makeOutputPath('xlsx'),
      format: 'xlsx',
      caseName: 'Test Case',
      filterSummary: {},
      ...overrides
    }
  }

  it('produces a valid XLSX file with Variants sheet', async () => {
    insertVariant(db, caseId, { chr: '1', pos: 100, gene_symbol: 'BRCA1' })
    const params = makeXlsxParams()
    const result = await runExportPipeline(params)

    expect(result.rowCount).toBe(1)
    expect(existsSync(params.outputFilePath)).toBe(true)

    const wb = readXlsxFile(params.outputFilePath)
    expect(wb.SheetNames).toContain('Variants')
  })

  it('Variants sheet has correct headers in first row', async () => {
    insertVariant(db, caseId, { chr: '1', pos: 100 })
    const params = makeXlsxParams()
    await runExportPipeline(params)

    const wb = readXlsxFile(params.outputFilePath)
    const ws = wb.Sheets['Variants']
    const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 }) as string[][]
    expect(data[0]).toEqual(EXPORT_COLUMNS.map((c) => c.header))
  })

  it('includes all data rows', async () => {
    insertVariant(db, caseId, { chr: '1', pos: 100, gene_symbol: 'BRCA1' })
    insertVariant(db, caseId, { chr: '2', pos: 200, gene_symbol: 'TP53' })
    const params = makeXlsxParams()
    const result = await runExportPipeline(params)

    expect(result.rowCount).toBe(2)

    const wb = readXlsxFile(params.outputFilePath)
    const ws = wb.Sheets['Variants']
    const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 }) as string[][]
    expect(data).toHaveLength(3) // header + 2 data rows
  })

  it('includes Export Info metadata sheet', async () => {
    insertVariant(db, caseId, { chr: '1', pos: 100 })
    const params = makeXlsxParams({ caseName: 'My Case' })
    await runExportPipeline(params)

    const wb = readXlsxFile(params.outputFilePath)
    expect(wb.SheetNames).toContain('Export Info')

    const metaWs = wb.Sheets['Export Info']
    const metaData = XLSX.utils.sheet_to_json<string[]>(metaWs, { header: 1 }) as string[][]
    const hasCase = metaData.some((row) => row.includes('My Case'))
    expect(hasCase).toBe(true)
  })

  it('metadata sheet includes active filter summary', async () => {
    insertVariant(db, caseId, { chr: '1', pos: 100 })
    const params = makeXlsxParams({
      filterSummary: {
        gene_symbol: 'BRCA1',
        consequences: ['HIGH'],
        gnomad_af_max: 0.01
      }
    })
    await runExportPipeline(params)

    const wb = readXlsxFile(params.outputFilePath)
    const metaWs = wb.Sheets['Export Info']
    const metaData = XLSX.utils.sheet_to_json<string[]>(metaWs, { header: 1 }) as string[][]
    const flat = metaData.flat()
    expect(flat).toContain('BRCA1')
    expect(flat).toContain('HIGH')
    expect(flat).toContain(0.01)
  })

  it('correctly formats gnomad_af in XLSX cells', async () => {
    insertVariant(db, caseId, { chr: '1', pos: 100, gnomad_af: 0.00015 })
    const params = makeXlsxParams()
    await runExportPipeline(params)

    const wb = readXlsxFile(params.outputFilePath)
    const ws = wb.Sheets['Variants']
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws) as Record<string, unknown>[]
    expect(data[0]['gnomAD AF']).toBe('1.50e-4')
  })

  it('produces a valid XLSX with no variants (header only)', async () => {
    const params = makeXlsxParams({ caseName: 'Empty Case' })
    const result = await runExportPipeline(params)

    expect(result.rowCount).toBe(0)

    const wb = readXlsxFile(params.outputFilePath)
    const ws = wb.Sheets['Variants']
    const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 }) as string[][]
    expect(data).toHaveLength(1) // header only
  })

  it('calls onProgress callback', async () => {
    insertVariant(db, caseId, { chr: '1', pos: 100 })
    const onProgress = vi.fn()
    const params = makeXlsxParams({ onProgress })
    await runExportPipeline(params)

    expect(onProgress).toHaveBeenCalledWith(0, 0)
  })

  it('returns correct result shape', async () => {
    insertVariant(db, caseId, { chr: '1', pos: 100 })
    const params = makeXlsxParams()
    const result = await runExportPipeline(params)

    expect(result.rowCount).toBe(1)
    expect(result.filePath).toBe(params.outputFilePath)
  })
})
