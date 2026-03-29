import { z } from 'zod'
import { dialog, BrowserWindow } from 'electron'
import * as XLSX from 'xlsx'
import { writeFile } from 'fs/promises'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import { CohortService } from '../../database/cohort'
import type { VariantFilter } from '../../database/types'
import type { CohortSearchParams, CohortVariant } from '../../../shared/types/cohort'
import { mainLogger } from '../../services/MainLogger'
import {
  CaseIdSchema,
  VariantFilterPartialSchema,
  CohortSearchParamsSchema
} from '../../../shared/types/ipc-schemas'
import { ExportWorkerClient } from '../../workers/export-worker-client'
import type { ExportFilterSummary } from '../../../shared/types/export-worker'

const EXPORT_HARD_LIMIT = 100_000

/** Schema for variant export parameters */
const VariantExportParamsSchema = z.object({
  caseId: CaseIdSchema,
  filters: VariantFilterPartialSchema,
  caseName: z.string().min(1).max(500)
})

/**
 * Export IPC handlers
 * Channels: export:variants, export:cohort
 */

// Cohort export column headers
const COHORT_EXPORT_COLUMNS = [
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

export function registerExportHandlers({ ipcMain, getDb }: HandlerDependencies): void {
  ipcMain.handle(
    'export:variants',
    async (
      _event,
      caseId: unknown,
      filters: unknown,
      caseName: unknown
    ): Promise<{ success: boolean; filePath?: string; error?: string }> => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validated = VariantExportParamsSchema.safeParse({ caseId, filters, caseName })
        if (!validated.success) {
          mainLogger.error(`Invalid export:variants params: ${validated.error.message}`, 'export')
          throw new Error('Invalid parameters')
        }

        mainLogger.debug(
          `Export handler called with caseId=${validated.data.caseId}, caseName=${validated.data.caseName}`,
          'export'
        )
        const db = getDb()
        const mainWindow = BrowserWindow.getAllWindows()[0]

        if (mainWindow === undefined || mainWindow.isDestroyed()) {
          return { success: false, error: 'No window available for export dialog' }
        }

        // Pre-check: count matching variants before showing dialog
        const fullFilter: VariantFilter = {
          ...validated.data.filters,
          case_id: validated.data.caseId
        }
        const count = db.variants.getExportCount(fullFilter)

        if (count > EXPORT_HARD_LIMIT) {
          return {
            success: false,
            error: `Export limited to ${EXPORT_HARD_LIMIT.toLocaleString()} variants. Current filter matches ${count.toLocaleString()} variants. Please narrow your filters.`
          }
        }

        // Show save dialog
        const defaultFileName = `${validated.data.caseName.replace(/[^a-z0-9]/gi, '_')}_variants.xlsx`
        const result = await dialog.showSaveDialog(mainWindow, {
          title: 'Export Variants to Excel',
          defaultPath: defaultFileName,
          filters: [
            { name: 'Excel Files', extensions: ['xlsx'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        })

        if (result.canceled === true || result.filePath === undefined || result.filePath === '') {
          return { success: false, error: 'Export cancelled' }
        }

        // Compile query on main thread (uses Kysely, all 17 filter params)
        const compiled = db.variants.compileExportQuery(fullFilter, EXPORT_HARD_LIMIT)

        // Build filter summary for metadata sheet
        const vFilters = validated.data.filters
        const filterSummary: ExportFilterSummary = {
          ...(vFilters.gene_symbol !== undefined && vFilters.gene_symbol !== ''
            ? { gene_symbol: vFilters.gene_symbol }
            : {}),
          ...(vFilters.consequences !== undefined && vFilters.consequences.length > 0
            ? { consequences: vFilters.consequences }
            : {}),
          ...(vFilters.funcs !== undefined && vFilters.funcs.length > 0
            ? { funcs: vFilters.funcs }
            : {}),
          ...(vFilters.clinvars !== undefined && vFilters.clinvars.length > 0
            ? { clinvars: vFilters.clinvars }
            : {}),
          ...(vFilters.gnomad_af_max !== undefined
            ? { gnomad_af_max: vFilters.gnomad_af_max }
            : {}),
          ...(vFilters.cadd_min !== undefined ? { cadd_min: vFilters.cadd_min } : {})
        }

        // Spawn worker for XLSX generation
        const workerClient = new ExportWorkerClient()

        return new Promise<{
          success: boolean
          filePath?: string
          error?: string
        }>((resolve) => {
          workerClient.start({
            dbPath: db.getPath(),
            encryptionKey: db.getEncryptionKey(),
            compiledSql: compiled.sql,
            compiledParams: compiled.parameters,
            outputFilePath: result.filePath!,
            caseName: validated.data.caseName,
            filterSummary,
            onProgress: (current, total) => {
              if (!mainWindow.isDestroyed()) {
                mainWindow.webContents.send('export:progress', { current, total })
              }
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
      }) as Promise<{ success: boolean; filePath?: string; error?: string }>
    }
  )

  ipcMain.handle(
    'export:cohort',
    async (
      _event,
      params: unknown
    ): Promise<{ success: boolean; filePath?: string; error?: string }> => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validated = CohortSearchParamsSchema.safeParse(params)
        if (!validated.success) {
          mainLogger.error(`Invalid export:cohort params: ${validated.error.message}`, 'export')
          throw new Error('Invalid parameters')
        }

        mainLogger.debug(
          `Cohort export handler called with params: ${JSON.stringify(validated.data)}`,
          'export'
        )
        const db = getDb()
        const cohortService = new CohortService(db.database)
        const mainWindow = BrowserWindow.getAllWindows()[0]

        // Check for valid window before showing dialog
        if (mainWindow === undefined || mainWindow.isDestroyed()) {
          mainLogger.warn(
            'Window closed before cohort export dialog, cannot show save dialog',
            'export'
          )
          return { success: false, error: 'No window available for export dialog' }
        }

        // Show save dialog
        const defaultFileName = `cohort_variants_${new Date().toISOString().slice(0, 10)}.xlsx`
        const result = await dialog.showSaveDialog(mainWindow, {
          title: 'Export Cohort Variants to Excel',
          defaultPath: defaultFileName,
          filters: [
            { name: 'Excel Files', extensions: ['xlsx'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        })

        if (result.canceled === true || result.filePath === undefined || result.filePath === '') {
          return { success: false, error: 'Export cancelled' }
        }

        // Get cohort variants matching filters (hard limit of 100k rows — sufficient for typical cohorts)
        const exportParams: CohortSearchParams = {
          ...validated.data,
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
          ...(validated.data.search_term !== undefined && validated.data.search_term !== ''
            ? [['Search Term', validated.data.search_term]]
            : []),
          ...(validated.data.gene_symbol !== undefined && validated.data.gene_symbol !== ''
            ? [['Gene', validated.data.gene_symbol]]
            : []),
          ...(validated.data.consequences !== undefined && validated.data.consequences.length > 0
            ? [['Impact Levels', validated.data.consequences.join(', ')]]
            : []),
          ...(validated.data.funcs !== undefined && validated.data.funcs.length > 0
            ? [['Functions', validated.data.funcs.join(', ')]]
            : []),
          ...(validated.data.clinvars !== undefined && validated.data.clinvars.length > 0
            ? [['ClinVar', validated.data.clinvars.join(', ')]]
            : []),
          ...(validated.data.gnomad_af_max !== undefined
            ? [['Max gnomAD AF', validated.data.gnomad_af_max]]
            : []),
          ...(validated.data.cadd_min !== undefined ? [['Min CADD', validated.data.cadd_min]] : []),
          ...(validated.data.max_internal_af !== undefined
            ? [['Max Internal Frequency', `${(validated.data.max_internal_af * 100).toFixed(1)}%`]]
            : []),
          ...(validated.data.carrier_count_min !== undefined
            ? [['Min Carrier Count', validated.data.carrier_count_min]]
            : [])
        ]
        const metaWs = XLSX.utils.aoa_to_sheet(metaData)
        XLSX.utils.book_append_sheet(wb, metaWs, 'Export Info')

        // Write file
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
        await writeFile(result.filePath, buffer)

        return { success: true, filePath: result.filePath }
      }) as Promise<{ success: boolean; filePath?: string; error?: string }>
    }
  )
}
