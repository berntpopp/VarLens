/**
 * Pure export pipeline logic extracted from export-worker.ts.
 *
 * This module handles the core export orchestration (query execution,
 * CSV streaming, XLSX worksheet building) without any worker_threads
 * dependencies (parentPort, workerData). This makes the logic testable
 * in isolation.
 */
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import {
  accessSync,
  closeSync,
  constants,
  createWriteStream,
  existsSync,
  fchmodSync,
  fstatSync,
  openSync,
  rmSync,
  statSync
} from 'node:fs'
import { rename } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export function defaultExportTempFilePath(outputFilePath: string): string {
  return join(dirname(outputFilePath), `.varlens-export-${randomUUID()}.part`)
}

export function prepareExportFilePath(
  outputFilePath: string,
  customTempFilePath?: string
): {
  tempFilePath: string
  isDevice: boolean
} {
  if (existsSync(outputFilePath)) {
    accessSync(outputFilePath, constants.W_OK)
  }
  const isDevice = outputFilePath.startsWith('/dev/')
  const tempFilePath = isDevice
    ? outputFilePath
    : (customTempFilePath ?? defaultExportTempFilePath(outputFilePath))
  return { tempFilePath, isDevice }
}
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
  tempFilePath?: string
  tempFilePrecreated?: { dev: number; ino: number } | boolean
  format: 'csv' | 'xlsx'
  caseName: string
  filterSummary: ExportFilterSummary
  onProgress?: (current: number, total: number) => void
}

/** Result returned by the export pipeline. */
export interface ExportPipelineResult {
  rowCount: number
  filePath: string
  truncated?: boolean
}

/**
 * Shared generator that chunks variants and attaches annotations.
 * stmt.iterate is entered on first pull and always closed in finally.
 * Holds a DEFERRED read transaction across the entire iteration so that
 * partial trailing chunks observe a consistent read snapshot.
 */
export function* iterateAnnotatedRows(
  db: DatabaseType,
  compiledSql: string,
  compiledParams: readonly unknown[]
): Generator<Record<string, unknown>> {
  const startedTx = !db.inTransaction
  if (startedTx) db.exec('BEGIN DEFERRED')
  let iterator: IterableIterator<Record<string, unknown>> | undefined

  try {
    const stmt = db.prepare(compiledSql)
    iterator = stmt.iterate(...compiledParams) as IterableIterator<Record<string, unknown>>
    const batchLookup = createCaseAnnotationBatchLookup(db)

    let chunk: Record<string, unknown>[] = []
    for (const variant of iterator) {
      chunk.push(variant)
      if (chunk.length >= 200) {
        const annotations = batchLookup(chunk)
        for (const v of chunk) {
          yield { ...v, ...annotations.get(v.id) }
        }
        chunk = []
      }
    }
    if (chunk.length > 0) {
      const annotations = batchLookup(chunk)
      for (const v of chunk) {
        yield { ...v, ...annotations.get(v.id) }
      }
    }
  } finally {
    iterator?.return?.()
    if (startedTx && db.inTransaction) {
      db.exec('ROLLBACK')
    }
  }
}

export interface StreamToExportFileOptions {
  outputFilePath: string
  customTempFilePath?: string
  tempFilePrecreated?: { dev: number; ino: number } | boolean
  encoding?: BufferEncoding
}

/**
 * Shared helper that opens a temporary export file (or device), verifies its
 * inode identity against client reservations, sets permissions, streams source chunks,
 * renames atomically to outputFilePath, and safely cleans up partial files on error.
 */
export async function streamToExportFile(
  source: Iterable<unknown> | AsyncIterable<unknown>,
  options: StreamToExportFileOptions
): Promise<void> {
  const { outputFilePath, customTempFilePath, tempFilePrecreated, encoding } = options
  const { tempFilePath, isDevice } = prepareExportFilePath(outputFilePath, customTempFilePath)

  let fd: number | null = null
  let createdTempFile = false
  let stream: ReturnType<typeof createWriteStream> | null = null

  try {
    if (isDevice) {
      stream = createWriteStream(tempFilePath, encoding !== undefined ? { encoding } : undefined)
    } else {
      let targetMode = 0o600
      try {
        targetMode = statSync(outputFilePath).mode & 0o777
      } catch {
        // Destination does not exist yet; default to 0o600
      }

      if (tempFilePrecreated !== undefined && tempFilePrecreated !== false) {
        const openFlags = constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0)
        fd = openSync(tempFilePath, openFlags)
        const st = fstatSync(fd)
        const isObjectExpected =
          typeof tempFilePrecreated === 'object' && tempFilePrecreated !== null
        const identityMismatch =
          !st.isFile() ||
          (isObjectExpected &&
            (st.dev !== tempFilePrecreated.dev || st.ino !== tempFilePrecreated.ino))

        if (identityMismatch) {
          throw new Error('Temporary export file identity mismatch')
        }
        createdTempFile = true
        fchmodSync(fd, targetMode)
      } else {
        fd = openSync(tempFilePath, 'wx', targetMode)
        createdTempFile = true
        fchmodSync(fd, targetMode)
      }

      stream = createWriteStream(tempFilePath, {
        fd,
        autoClose: true,
        ...(encoding !== undefined ? { encoding } : {})
      })
    }

    await pipeline(Readable.from(source), stream)
    if (!isDevice) {
      await rename(tempFilePath, outputFilePath)
    }
  } catch (error) {
    if (stream !== null) {
      stream.destroy()
    } else if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        // ignore
      }
    }
    if (createdTempFile && !isDevice) {
      try {
        rmSync(tempFilePath, { force: true })
      } catch {
        // ignore
      }
    }
    throw error
  }
}

/**
 * Run the CSV export pipeline: stream query results to a CSV file.
 */
async function runCsvPipeline(params: ExportPipelineParams): Promise<ExportPipelineResult> {
  const {
    db,
    compiledSql,
    compiledParams,
    outputFilePath,
    tempFilePath: customTempFilePath,
    tempFilePrecreated,
    onProgress
  } = params

  onProgress?.(0, 0)

  let rowCount = 0
  function* csvLines(): Generator<string> {
    yield EXPORT_COLUMNS.map((col) => csvEscape(col.header)).join(',') + '\r\n'
    for (const row of iterateAnnotatedRows(db, compiledSql, compiledParams)) {
      const cells = EXPORT_COLUMNS.map((col) => csvEscape(formatCellValue(col.key, row[col.key])))
      yield cells.join(',') + '\r\n'
      rowCount++
      if (rowCount % 1000 === 0) onProgress?.(rowCount, 0)
    }
  }

  await streamToExportFile(csvLines(), {
    outputFilePath,
    customTempFilePath,
    tempFilePrecreated,
    encoding: 'utf8'
  })

  onProgress?.(rowCount, rowCount)
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
  const {
    db,
    compiledSql,
    compiledParams,
    outputFilePath,
    tempFilePath: customTempFilePath,
    tempFilePrecreated,
    caseName,
    filterSummary,
    onProgress
  } = params

  onProgress?.(0, 0)

  const headers = EXPORT_COLUMNS.map((col) => col.header)
  const result: XlsxStreamResult = { rowCount: 0, truncated: false }

  async function* generateRows(): AsyncGenerator<readonly XlsxCell[]> {
    for (const row of iterateAnnotatedRows(db, compiledSql, compiledParams)) {
      yield EXPORT_COLUMNS.map((col) => formatCellValue(col.key, row[col.key]))
      if ((result.rowCount + 1) % 1000 === 0) {
        onProgress?.(result.rowCount + 1, 0)
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
    rows: (res: XlsxStreamResult) => [
      ...buildMetadataSheet(caseName, res.rowCount, filterSummary),
      ...(res.truncated ? [['Truncated', 'Excel row limit reached; use CSV for all rows']] : [])
    ]
  }

  await streamToExportFile(xlsxStream(sheet, result, info), {
    outputFilePath,
    customTempFilePath,
    tempFilePrecreated
  })

  onProgress?.(result.rowCount, result.rowCount)
  return {
    rowCount: result.rowCount,
    filePath: outputFilePath,
    ...(result.truncated ? { truncated: true } : {})
  }
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
