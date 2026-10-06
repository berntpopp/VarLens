/**
 * Pure business logic for export IPC handlers.
 *
 * All functions take explicit dependencies (db, callbacks) as parameters
 * and never touch IPC/Electron APIs directly. This makes them testable
 * without mocking Electron internals.
 */
import * as XLSX from 'xlsx'
import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import { writeFile } from 'fs/promises'
import { mainLogger } from '../../services/MainLogger'
import { CohortService } from '../../database/cohort'
import { ExportWorkerClient } from '../../workers/export-worker-client'
import type { DatabaseService } from '../../database/DatabaseService'
import type { VariantFilter } from '../../database/types'
import type { CohortSearchParams, CohortVariant } from '../../../shared/types/cohort'
import type { ExportFilterSummary } from '../../../shared/types/export-worker'
import { EXPORT_COLUMNS, type ExportColumn } from '../../workers/export-pipeline'
import { csvEscape, formatCellValue } from '../../workers/export-renderer'

const EXPORT_HARD_LIMIT = 100_000

// Cohort export column headers
export const COHORT_EXPORT_COLUMNS: readonly ExportColumn[] = [
  { key: 'chr', header: 'Chromosome' },
  { key: 'pos', header: 'Position' },
  { key: 'ref', header: 'Reference' },
  { key: 'alt', header: 'Alternate' },
  { key: 'gene_symbol', header: 'Gene' },
  { key: 'cdna', header: 'cDNA Change' },
  { key: 'aa_change', header: 'AA Change' },
  { key: 'consequence', header: 'Impact' },
  { key: 'func', header: 'Function' },
  { key: 'clinvar', header: 'ClinVar' },
  { key: 'gnomad_af', header: 'gnomAD AF' },
  { key: 'cadd_phred', header: 'CADD Score' },
  { key: 'carrier_count', header: 'Carriers' },
  { key: 'total_cases', header: 'Total Cases' },
  { key: 'cohort_frequency', header: 'Cohort Frequency' },
  { key: 'het_count', header: 'Heterozygous' },
  { key: 'hom_count', header: 'Homozygous' },
  { key: 'transcript', header: 'Transcript' }
]

/** Callbacks for emitting events to the renderer during export. */
export interface ExportCallbacks {
  onProgress?: (data: { current: number; total: number }) => void
}

/** Result type for export operations. */
export interface ExportResult {
  success: boolean
  filePath?: string
  error?: string
}

/**
 * Pre-check variant count and compile export query.
 * If the count exceeds the hard limit, returns an ExportResult with success: false.
 */
export function prepareVariantExport(
  getDb: () => DatabaseService,
  caseId: number,
  filters: Partial<VariantFilter>
):
  | {
      compiled: { sql: string; parameters: readonly unknown[] }
      count: number
    }
  | ExportResult {
  const db = getDb()
  const fullFilter: VariantFilter = {
    ...filters,
    case_id: caseId
  }
  const count = db.variants.getExportCount(fullFilter)

  if (count > EXPORT_HARD_LIMIT) {
    return {
      success: false,
      error: `Export limited to ${EXPORT_HARD_LIMIT.toLocaleString()} variants. Current filter matches ${count.toLocaleString()} variants. Please narrow your filters.`
    }
  }

  const compiled = db.variants.compileExportQuery(fullFilter, EXPORT_HARD_LIMIT)
  return { compiled, count }
}

/**
 * Build filter summary for metadata sheet from variant filters.
 */
export function buildFilterSummary(filters: Partial<VariantFilter>): ExportFilterSummary {
  return {
    ...(filters.gene_symbol !== undefined && filters.gene_symbol !== ''
      ? { gene_symbol: filters.gene_symbol }
      : {}),
    ...(filters.consequences !== undefined && filters.consequences.length > 0
      ? { consequences: filters.consequences }
      : {}),
    ...(filters.funcs !== undefined && filters.funcs.length > 0 ? { funcs: filters.funcs } : {}),
    ...(filters.clinvars !== undefined && filters.clinvars.length > 0
      ? { clinvars: filters.clinvars }
      : {}),
    ...(filters.gnomad_af_max !== undefined ? { gnomad_af_max: filters.gnomad_af_max } : {}),
    ...(filters.cadd_min !== undefined ? { cadd_min: filters.cadd_min } : {})
  }
}

/**
 * Export variants to XLSX via worker thread.
 *
 * Callers must run {@link prepareVariantExport} first (before showing any
 * save-dialog) and pass the resulting `compiled` query here. This avoids a
 * redundant count query and, more importantly, ensures users are never asked
 * to pick a file path only to be told the export exceeds the hard limit.
 */
export function exportVariants(
  getDb: () => DatabaseService,
  compiled: { sql: string; parameters: readonly unknown[] },
  filters: Partial<VariantFilter>,
  caseName: string,
  outputFilePath: string,
  callbacks: ExportCallbacks
): Promise<ExportResult> {
  const db = getDb()
  const filterSummary = buildFilterSummary(filters)

  const workerClient = new ExportWorkerClient()

  return new Promise<ExportResult>((resolve) => {
    workerClient.start({
      dbPath: db.getPath(),
      encryptionKey: db.getEncryptionKey(),
      compiledSql: compiled.sql,
      compiledParams: compiled.parameters,
      outputFilePath,
      caseName,
      filterSummary,
      onProgress: (current, total) => {
        callbacks.onProgress?.({ current, total })
      },
      onComplete: (filePath, rowCount) => {
        mainLogger.info(`Export complete: ${rowCount} variants to ${filePath}`, 'export')
        resolve({ success: true, filePath })
      },
      onError: (error) => {
        mainLogger.error(`Export worker error: ${error}`, 'export')
        resolve({ success: false, error })
      }
    })
  })
}

async function exportRowsToCsv(
  rows: AsyncIterable<Record<string, unknown>>,
  outputFilePath: string,
  columns: readonly ExportColumn[],
  callbacks: ExportCallbacks,
  label: string
): Promise<ExportResult> {
  const stream = createWriteStream(outputFilePath, { encoding: 'utf8' })

  const writeLine = async (line: string): Promise<void> => {
    if (stream.write(`${line}\r\n`)) {
      return
    }

    await Promise.race([
      once(stream, 'drain'),
      once(stream, 'error').then(([error]) => Promise.reject(error))
    ])
  }

  try {
    await Promise.race([
      once(stream, 'open'),
      once(stream, 'error').then(([error]) => Promise.reject(error))
    ])
    await writeLine(columns.map((column) => csvEscape(column.header)).join(','))

    let rowCount = 0
    for await (const row of rows) {
      const line = columns
        .map((column) => csvEscape(formatCellValue(column.key, row[column.key])))
        .join(',')
      await writeLine(line)
      rowCount += 1

      if (rowCount % 1000 === 0) {
        callbacks.onProgress?.({ current: rowCount, total: 0 })
      }
    }

    await new Promise<void>((resolve, reject) => {
      stream.on('finish', resolve)
      stream.on('error', reject)
      stream.end()
    })

    mainLogger.info(`${label} complete: ${rowCount} rows to ${outputFilePath}`, 'export')
    return { success: true, filePath: outputFilePath }
  } catch (error) {
    stream.destroy()
    const message = error instanceof Error ? error.message : String(error)
    mainLogger.error(`${label} error: ${message}`, 'export')
    return { success: false, error: message }
  }
}

export function exportPostgresVariants(
  rows: AsyncIterable<Record<string, unknown>>,
  outputFilePath: string,
  callbacks: ExportCallbacks
): Promise<ExportResult> {
  return exportRowsToCsv(
    rows,
    outputFilePath,
    EXPORT_COLUMNS,
    callbacks,
    'PostgreSQL variant export'
  )
}

export function exportPostgresCohort(
  rows: AsyncIterable<Record<string, unknown>>,
  outputFilePath: string,
  callbacks: ExportCallbacks
): Promise<ExportResult> {
  return exportRowsToCsv(
    rows,
    outputFilePath,
    COHORT_EXPORT_COLUMNS,
    callbacks,
    'PostgreSQL cohort export'
  )
}

/**
 * Export cohort variants to XLSX file.
 */
export async function exportCohort(
  getDb: () => DatabaseService,
  params: CohortSearchParams,
  outputFilePath: string
): Promise<ExportResult> {
  const db = getDb()
  const cohortService = new CohortService(db.database)

  // Get cohort variants matching filters (hard limit of 100k rows)
  const exportParams: CohortSearchParams = {
    ...params,
    limit: 100000
  }
  const cohortResult = cohortService.getCohortVariants(exportParams)
  const variants = cohortResult.data

  // Convert variants to worksheet data
  const headers = COHORT_EXPORT_COLUMNS.map((col) => col.header)
  const rows = variants.map((variant: CohortVariant) =>
    COHORT_EXPORT_COLUMNS.map((col) => {
      const value = variant[col.key as keyof CohortVariant]
      // Format specific columns
      if (col.key === 'gnomad_af' && typeof value === 'number') {
        return value.toExponential(2)
      }
      if (col.key === 'cadd_phred' && typeof value === 'number') {
        return value.toFixed(2)
      }
      if (col.key === 'cohort_frequency' && typeof value === 'number') {
        return `${(value * 100).toFixed(1)}%`
      }
      return value ?? ''
    })
  )

  // Create workbook
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])

  // Set column widths
  ws['!cols'] = COHORT_EXPORT_COLUMNS.map((col) => ({
    wch: col.key === 'aa_change' || col.key === 'cdna' ? 20 : 15
  }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Cohort Variants')

  // Add metadata sheet
  const summary = cohortService.getCohortSummary()
  const metaData = [
    ['Cohort Export Information'],
    ['Total Cases in Cohort', summary.total_cases],
    ['Unique Variants Exported', variants.length],
    ['Export Date', new Date().toISOString()],
    [''],
    ['Active Filters'],
    ...(params.search_term !== undefined && params.search_term !== ''
      ? [['Search Term', params.search_term]]
      : []),
    ...(params.gene_symbol !== undefined && params.gene_symbol !== ''
      ? [['Gene', params.gene_symbol]]
      : []),
    ...(params.consequences !== undefined && params.consequences.length > 0
      ? [['Impact Levels', params.consequences.join(', ')]]
      : []),
    ...(params.funcs !== undefined && params.funcs.length > 0
      ? [['Functions', params.funcs.join(', ')]]
      : []),
    ...(params.clinvars !== undefined && params.clinvars.length > 0
      ? [['ClinVar', params.clinvars.join(', ')]]
      : []),
    ...(params.gnomad_af_max !== undefined ? [['Max gnomAD AF', params.gnomad_af_max]] : []),
    ...(params.cadd_min !== undefined ? [['Min CADD', params.cadd_min]] : []),
    ...(params.max_internal_af !== undefined
      ? [['Max Internal Frequency', `${(params.max_internal_af * 100).toFixed(1)}%`]]
      : []),
    ...(params.carrier_count_min !== undefined
      ? [['Min Carrier Count', params.carrier_count_min]]
      : [])
  ]
  const metaWs = XLSX.utils.aoa_to_sheet(metaData)
  XLSX.utils.book_append_sheet(wb, metaWs, 'Export Info')

  // Write file
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  await writeFile(outputFilePath, buffer)

  return { success: true, filePath: outputFilePath }
}
