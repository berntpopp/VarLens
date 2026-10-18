/**
 * Cohort XLSX export — runs inside the export worker.
 *
 * Streams query results in pages to an XLSX file using xlsxStream, avoiding
 * blocking the event loop and bounding memory usage.
 */
import { createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { CohortService } from '../database/cohort'
import { isCohortSummaryStale } from '../database/cohort-summary-case-removal'
import { CohortSummaryRefreshingError } from '../../shared/errors/cohort-summary-refreshing'
import type { CohortSearchParams } from '../../shared/types/cohort'
import type { ExportColumn } from './export-pipeline'
import { formatCellValue } from './export-renderer'
import { COHORT_ANNOTATION_EXPORT_COLUMNS } from '../../shared/config/export.config'
import { createCohortAnnotationBatchLookup } from '../database/annotation-export-lookup'
import {
  xlsxStream,
  type XlsxSheetSpec,
  type XlsxStreamResult,
  type XlsxCell
} from '../../web/server/downloads/xlsx-stream'

export const COHORT_EXPORT_HARD_LIMIT = 100_000
const PAGE_SIZE = 5_000
const PROGRESS_EVERY_ROWS = 5_000

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

function formatCohortCell(key: string, value: unknown): XlsxCell {
  if (key === 'cohort_frequency' && typeof value === 'number') {
    return `${(value * 100).toFixed(1)}%`
  }
  return formatCellValue(key, value) as XlsxCell
}

function buildCohortMetadata(
  params: CohortSearchParams,
  totalCases: number,
  exported: number
): (string | number)[][] {
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
 * Query the cohort in pages of 5 000 (capped at {@link COHORT_EXPORT_HARD_LIMIT})
 * and stream an XLSX workbook incrementally.
 */
export async function runCohortExport(
  db: DatabaseType,
  params: CohortSearchParams,
  outputFilePath: string,
  onProgress: (current: number, total: number) => void
): Promise<CohortExportResult> {
  // The summary is what gets exported: never write a file from a stale one.
  // The main process waited for a pending refresh before starting this job.
  if (isCohortSummaryStale(db)) throw new CohortSummaryRefreshingError()

  const startedTx = !db.inTransaction
  if (startedTx) db.exec('BEGIN DEFERRED')

  try {
    const cohortService = new CohortService(db)
    const summary = cohortService.getCohortSummary()
    onProgress(0, 0)
    const batchLookup = createCohortAnnotationBatchLookup(db)
    const headers = COHORT_EXPORT_COLUMNS.map((col) => col.header)
    const result: XlsxStreamResult = { rowCount: 0, truncated: false }

    let totalCount = 0
    let initialProgressReported = false
    let yieldedRows = 0

    async function* generateCohortRows(): AsyncGenerator<readonly XlsxCell[]> {
      let offset = 0
      while (offset < COHORT_EXPORT_HARD_LIMIT) {
        const pageLimit = Math.min(PAGE_SIZE, COHORT_EXPORT_HARD_LIMIT - offset)
        const page = cohortService.getCohortVariants({
          ...params,
          limit: pageLimit,
          offset
        })

        if (!initialProgressReported) {
          totalCount = Math.min(page.total_count, COHORT_EXPORT_HARD_LIMIT)
          onProgress(0, totalCount)
          initialProgressReported = true
        }

        const variants = page.data
        if (variants.length === 0) break

        for (let i = 0; i < variants.length; i += 200) {
          const chunk = variants.slice(i, i + 200)
          const annotations = batchLookup(chunk)
          for (const variant of chunk) {
            const key =
              (variant as { id?: unknown }).id ??
              `${variant.chr}:${variant.pos}:${variant.ref}:${variant.alt}:${variant.genome_build}`
            const ann = annotations.get(key)
            const row: Record<string, unknown> = { ...variant, ...ann }
            yield COHORT_EXPORT_COLUMNS.map((col) => formatCohortCell(col.key, row[col.key]))
            yieldedRows += 1
            if (yieldedRows % PROGRESS_EVERY_ROWS === 0) {
              onProgress(yieldedRows, totalCount)
            }
          }
        }

        offset += variants.length
        if (variants.length < pageLimit) break
      }

      if (!initialProgressReported) {
        onProgress(0, 0)
      }
    }

    const sheet: XlsxSheetSpec = {
      name: 'Cohort Variants',
      header: headers,
      rows: generateCohortRows()
    }

    const info = {
      name: 'Export Info',
      rows: (res: XlsxStreamResult) =>
        buildCohortMetadata(params, summary.total_cases, res.rowCount)
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

    onProgress(result.rowCount, result.rowCount)
    return { filePath: outputFilePath, rowCount: result.rowCount }
  } finally {
    if (startedTx && db.inTransaction) {
      db.exec('ROLLBACK')
    }
  }
}
