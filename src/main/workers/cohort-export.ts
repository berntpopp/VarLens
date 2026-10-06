/**
 * Cohort XLSX export — runs inside the export worker.
 *
 * Previously this ran on the Electron main thread (audit 05 finding M-3): a
 * 100k-row cohort query, `aoa_to_sheet` and `XLSX.write` all blocked the
 * event loop with no progress or cancel. It now receives an open read-only
 * connection inside the worker; the main thread only relays progress and can
 * terminate the worker to cancel.
 */
import { writeFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { CohortService } from '../database/cohort'
import type { CohortSearchParams, CohortVariant } from '../../shared/types/cohort'
import type { ExportColumn } from './export-pipeline'

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

const PROGRESS_EVERY_ROWS = 5_000

function formatCohortCell(key: string, value: unknown): unknown {
  if (key === 'gnomad_af' && typeof value === 'number') return value.toExponential(2)
  if (key === 'cadd_phred' && typeof value === 'number') return value.toFixed(2)
  if (key === 'cohort_frequency' && typeof value === 'number') {
    return `${(value * 100).toFixed(1)}%`
  }
  return value ?? ''
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
    ...(hasList(params.funcs) ? [['Functions', params.funcs.join(', ')]] : []),
    ...(hasList(params.clinvars) ? [['ClinVar', params.clinvars.join(', ')]] : []),
    ...(params.gnomad_af_max !== undefined ? [['Max gnomAD AF', params.gnomad_af_max]] : []),
    ...(params.cadd_min !== undefined ? [['Min CADD', params.cadd_min]] : []),
    ...(params.max_internal_af !== undefined
      ? [['Max Internal Frequency', `${(params.max_internal_af * 100).toFixed(1)}%`]]
      : []),
    ...(params.carrier_count_min !== undefined
      ? [['Min Carrier Count', params.carrier_count_min]]
      : [])
  ]
}

export interface CohortExportResult {
  filePath: string
  rowCount: number
}

/**
 * Query the cohort (capped at {@link COHORT_EXPORT_HARD_LIMIT}) and write an
 * XLSX workbook. `onProgress(current, total)` fires after the query, every
 * {@link PROGRESS_EVERY_ROWS} rows while building, and once written.
 */
export function runCohortExport(
  db: DatabaseType,
  params: CohortSearchParams,
  outputFilePath: string,
  onProgress: (current: number, total: number) => void
): CohortExportResult {
  const cohortService = new CohortService(db)
  onProgress(0, 0)
  const variants = cohortService.getCohortVariants({
    ...params,
    limit: COHORT_EXPORT_HARD_LIMIT
  }).data
  const total = variants.length
  onProgress(0, total)

  const rows: unknown[][] = []
  for (const [index, variant] of variants.entries()) {
    rows.push(
      COHORT_EXPORT_COLUMNS.map((col) =>
        formatCohortCell(col.key, variant[col.key as keyof CohortVariant])
      )
    )
    if ((index + 1) % PROGRESS_EVERY_ROWS === 0) onProgress(index + 1, total)
  }

  const ws = XLSX.utils.aoa_to_sheet([COHORT_EXPORT_COLUMNS.map((col) => col.header), ...rows])
  ws['!cols'] = COHORT_EXPORT_COLUMNS.map((col) => ({
    wch: col.key === 'aa_change' || col.key === 'cdna' ? 20 : 15
  }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Cohort Variants')

  const summary = cohortService.getCohortSummary()
  const metaWs = XLSX.utils.aoa_to_sheet(buildCohortMetadata(params, summary.total_cases, total))
  XLSX.utils.book_append_sheet(wb, metaWs, 'Export Info')

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  writeFileSync(outputFilePath, buffer)
  onProgress(total, total)

  return { filePath: outputFilePath, rowCount: total }
}
