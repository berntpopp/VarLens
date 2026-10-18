/**
 * Pure export pipeline logic extracted from export-worker.ts.
 *
 * This module handles the core export orchestration (query execution,
 * CSV streaming, XLSX worksheet building) without any worker_threads
 * dependencies (parentPort, workerData). This makes the logic testable
 * in isolation.
 */
import { createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import type { ExportFilterSummary } from '../../shared/types/export-worker'
import { formatCellValue, csvEscape } from './export-renderer'
import { CASE_ANNOTATION_EXPORT_COLUMNS } from '../../shared/config/export.config'
import { createCaseAnnotationBatchLookup } from '../database/annotation-export-lookup'
import {
  xlsxStream,
  type XlsxSheetSpec,
  type XlsxStreamResult,
  type XlsxCell
} from '../../web/server/downloads/xlsx-stream'

/** Column definition for export output. */
export interface ExportColumn {
  key: string
  header: string
}

/** The standard set of columns exported from VarLens. */
export const EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'chr', header: 'Chromosome' },
  { key: 'pos', header: 'Position' },
  { key: 'ref', header: 'Reference' },
  { key: 'alt', header: 'Alternate' },
  { key: 'gt_num', header: 'Genotype' },
  { key: 'gene_symbol', header: 'Gene' },
  { key: 'func', header: 'Consequence' },
  { key: 'consequence', header: 'Impact' },
  { key: 'transcript', header: 'Transcript' },
  { key: 'cdna', header: 'cDNA' },
  { key: 'aa_change', header: 'AA Change' },
  { key: 'gnomad_af', header: 'gnomAD AF' },
  { key: 'cadd', header: 'CADD' },
  { key: 'qual', header: 'Quality' },
  { key: 'clinvar', header: 'ClinVar' },
  { key: 'hpo_sim_score', header: 'HPO Similarity' },
  { key: 'moi', header: 'MOI' },
  ...CASE_ANNOTATION_EXPORT_COLUMNS
]

/** Parameters for running an export pipeline. */
export interface ExportPipelineParams {
  db: DatabaseType
  compiledSql: string
  compiledParams: readonly unknown[]
  outputFilePath: string
  format: 'csv' | 'xlsx'
  caseName: string
  filterSummary: ExportFilterSummary
  onProgress?: (current: number, total: number) => void
}

/** Result returned by the export pipeline. */
export interface ExportPipelineResult {
  rowCount: number
  filePath: string
}

/**
 * Run the CSV export pipeline: stream query results to a CSV file.
 */
async function runCsvPipeline(params: ExportPipelineParams): Promise<ExportPipelineResult> {
  const { db, compiledSql, compiledParams, outputFilePath, onProgress } = params

  const stmt = db.prepare(compiledSql)
  const iterator = stmt.iterate(...compiledParams) as IterableIterator<Record<string, unknown>>

  onProgress?.(0, 0)

  const batchLookup = createCaseAnnotationBatchLookup(db)
  let rowCount = 0
  function* csvLines(): Generator<string> {
    yield EXPORT_COLUMNS.map((col) => csvEscape(col.header)).join(',') + '\r\n'
    let chunk: Record<string, unknown>[] = []
    for (const variant of iterator) {
      chunk.push(variant)
      if (chunk.length >= 200) {
        const annotations = batchLookup(chunk)
        for (const v of chunk) {
          const row: Record<string, unknown> = { ...v, ...annotations.get(v.id) }
          const cells = EXPORT_COLUMNS.map((col) =>
            csvEscape(formatCellValue(col.key, row[col.key]))
          )
          yield cells.join(',') + '\r\n'
          rowCount++
          if (rowCount % 1000 === 0) onProgress?.(rowCount, 0)
        }
        chunk = []
      }
    }
    if (chunk.length > 0) {
      const annotations = batchLookup(chunk)
      for (const v of chunk) {
        const row: Record<string, unknown> = { ...v, ...annotations.get(v.id) }
        const cells = EXPORT_COLUMNS.map((col) =>
          csvEscape(formatCellValue(col.key, row[col.key]))
        )
        yield cells.join(',') + '\r\n'
        rowCount++
        if (rowCount % 1000 === 0) onProgress?.(rowCount, 0)
      }
    }
  }

  const stream = createWriteStream(outputFilePath, { encoding: 'utf8' })
  let opened = false
  stream.once('open', () => (opened = true))
  try {
    // pipeline() handles backpressure and rejects on an open, write or source error.
    await pipeline(Readable.from(csvLines()), stream)
  } catch (error) {
    // Opening truncated the file, so a partial export is removed. A file that
    // could not be opened (e.g. an existing read-only one) is left untouched.
    if (opened) await rm(outputFilePath, { force: true }).catch(() => undefined)
    throw error
  }

  return { rowCount, filePath: outputFilePath }
}

/**
 * Build the metadata sheet array-of-arrays for XLSX export.
 */
export function buildMetadataSheet(
  caseName: string,
  totalVariants: number,
  filterSummary: ExportFilterSummary
): (string | number)[][] {
  return [
    ['Export Information'],
    ['Case Name', caseName],
    ['Total Variants', totalVariants],
    ['Export Date', new Date().toISOString()],
    [''],
    ['Active Filters'],
    ...(filterSummary.gene_symbol !== undefined && filterSummary.gene_symbol !== ''
      ? [['Gene', filterSummary.gene_symbol]]
      : []),
    ...(filterSummary.consequences !== undefined && filterSummary.consequences.length > 0
      ? [['Impact Levels', filterSummary.consequences.join(', ')]]
      : []),
    ...(filterSummary.funcs !== undefined && filterSummary.funcs.length > 0
      ? [['Consequences', filterSummary.funcs.join(', ')]]
      : []),
    ...(filterSummary.clinvars !== undefined && filterSummary.clinvars.length > 0
      ? [['ClinVar', filterSummary.clinvars.join(', ')]]
      : []),
    ...(filterSummary.gnomad_af_max !== undefined
      ? [['Max gnomAD AF', filterSummary.gnomad_af_max]]
      : []),
    ...(filterSummary.carrier_count_max !== undefined
      ? [['Max Carrier Cases', filterSummary.carrier_count_max]]
      : []),
    ...(filterSummary.cadd_min !== undefined ? [['Min CADD', filterSummary.cadd_min]] : [])
  ]
}

/**
 * Run the XLSX export pipeline: stream worksheets incrementally to file.
 */
async function runXlsxPipeline(params: ExportPipelineParams): Promise<ExportPipelineResult> {
  const { db, compiledSql, compiledParams, outputFilePath, caseName, filterSummary, onProgress } =
    params

  const stmt = db.prepare(compiledSql)
  const iterator = stmt.iterate(...compiledParams) as IterableIterator<Record<string, unknown>>

  onProgress?.(0, 0)

  const headers = EXPORT_COLUMNS.map((col) => col.header)
  const batchLookup = createCaseAnnotationBatchLookup(db)
  const result: XlsxStreamResult = { rowCount: 0, truncated: false }

  async function* generateRows(): AsyncGenerator<readonly XlsxCell[]> {
    let chunk: Record<string, unknown>[] = []
    for (const variant of iterator) {
      chunk.push(variant)
      if (chunk.length >= 200) {
        const annotations = batchLookup(chunk)
        for (const v of chunk) {
          const row: Record<string, unknown> = { ...v, ...annotations.get(v.id) }
          yield EXPORT_COLUMNS.map((col) => formatCellValue(col.key, row[col.key]))
          if ((result.rowCount + 1) % 1000 === 0) {
            onProgress?.(result.rowCount + 1, 0)
          }
        }
        chunk = []
      }
    }
    if (chunk.length > 0) {
      const annotations = batchLookup(chunk)
      for (const v of chunk) {
        const row: Record<string, unknown> = { ...v, ...annotations.get(v.id) }
        yield EXPORT_COLUMNS.map((col) => formatCellValue(col.key, row[col.key]))
        if ((result.rowCount + 1) % 1000 === 0) {
          onProgress?.(result.rowCount + 1, 0)
        }
      }
    }
  }

  const sheet: XlsxSheetSpec = {
    name: 'Variants',
    header: headers,
    rows: generateRows()
  }

  const info = {
    name: 'Export Info',
    rows: (res: XlsxStreamResult) => buildMetadataSheet(caseName, res.rowCount, filterSummary)
  }

  const stream = createWriteStream(outputFilePath)
  let opened = false
  stream.once('open', () => (opened = true))
  try {
    await pipeline(Readable.from(xlsxStream(sheet, result, info)), stream)
  } catch (error) {
    if (opened) await rm(outputFilePath, { force: true }).catch(() => undefined)
    throw error
  }

  onProgress?.(result.rowCount, result.rowCount)
  return { rowCount: result.rowCount, filePath: outputFilePath }
}

/**
 * Run the export pipeline for the given format.
 *
 * This is the main entry point — the worker shell delegates to this function
 * after setting up the DB connection and worker plumbing.
 */
export async function runExportPipeline(
  params: ExportPipelineParams
): Promise<ExportPipelineResult> {
  if (params.format === 'csv') {
    return runCsvPipeline(params)
  } else {
    return runXlsxPipeline(params)
  }
}
