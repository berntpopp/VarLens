/**
 * Pure export pipeline logic extracted from export-worker.ts.
 *
 * This module handles the core export orchestration (query execution,
 * CSV streaming, XLSX worksheet building) without any worker_threads
 * dependencies (parentPort, workerData). This makes the logic testable
 * in isolation.
 */
import { createWriteStream } from 'node:fs'
import { writeFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import type { ExportFilterSummary } from '../../shared/types/export-worker'
import { formatCellValue, csvEscape } from './export-renderer'

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

  const stream = createWriteStream(outputFilePath, { encoding: 'utf8' })

  // Attach error handler immediately to prevent unhandled 'error' event crash
  // if createWriteStream fails to open. The error is re-thrown in the finish promise below.
  stream.on('error', () => {})

  // Write header row
  const headerRow = EXPORT_COLUMNS.map((col) => csvEscape(col.header)).join(',')
  const headerOk = stream.write(headerRow + '\r\n')
  if (!headerOk) {
    await new Promise<void>((resolve) => stream.once('drain', resolve))
  }

  let rowCount = 0
  for (const row of iterator) {
    const cells = EXPORT_COLUMNS.map((col) => csvEscape(formatCellValue(col.key, row[col.key])))
    const ok = stream.write(cells.join(',') + '\r\n')
    if (!ok) {
      await new Promise<void>((resolve) => stream.once('drain', resolve))
    }
    rowCount++

    if (rowCount % 1000 === 0) {
      onProgress?.(rowCount, 0)
    }
  }

  // Wait for the write stream to flush to disk before reporting completion
  await new Promise<void>((resolve, reject) => {
    stream.on('finish', resolve)
    stream.on('error', reject)
    stream.end()
  })

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
      ? [['Consequences', filterSummary.consequences.join(', ')]]
      : []),
    ...(filterSummary.funcs !== undefined && filterSummary.funcs.length > 0
      ? [['Functions', filterSummary.funcs.join(', ')]]
      : []),
    ...(filterSummary.clinvars !== undefined && filterSummary.clinvars.length > 0
      ? [['ClinVar', filterSummary.clinvars.join(', ')]]
      : []),
    ...(filterSummary.gnomad_af_max !== undefined
      ? [['Max gnomAD AF', filterSummary.gnomad_af_max]]
      : []),
    ...(filterSummary.cadd_min !== undefined ? [['Min CADD', filterSummary.cadd_min]] : [])
  ]
}

/**
 * Run the XLSX export pipeline: build worksheets in memory and write to file.
 */
function runXlsxPipeline(params: ExportPipelineParams): ExportPipelineResult {
  const { db, compiledSql, compiledParams, outputFilePath, caseName, filterSummary, onProgress } =
    params

  const stmt = db.prepare(compiledSql)
  const iterator = stmt.iterate(...compiledParams) as IterableIterator<Record<string, unknown>>

  onProgress?.(0, 0)

  const headers = EXPORT_COLUMNS.map((col) => col.header)
  const rows: (string | number | null)[][] = []

  let i = 0
  for (const variant of iterator) {
    rows.push(EXPORT_COLUMNS.map((col) => formatCellValue(col.key, variant[col.key])))
    i++

    if (i % 1000 === 0) {
      onProgress?.(i, 0)
    }
  }

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
  ws['!cols'] = EXPORT_COLUMNS.map((col) => ({
    wch: col.key === 'aa_change' ? 20 : 15
  }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Variants')

  // Metadata sheet (includes active filter summary)
  const metaData = buildMetadataSheet(caseName, i, filterSummary)
  const metaWs = XLSX.utils.aoa_to_sheet(metaData)
  XLSX.utils.book_append_sheet(wb, metaWs, 'Export Info')

  // Write file — use XLSX.write + writeFileSync for ESM compatibility
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  writeFileSync(outputFilePath, buf)

  return { rowCount: i, filePath: outputFilePath }
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
