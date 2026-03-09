import { z } from 'zod'
import { dialog, BrowserWindow } from 'electron'
import * as XLSX from 'xlsx'
import { writeFile } from 'fs/promises'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import { CohortService } from '../../database/cohort'
import type { Variant, VariantFilter } from '../../database/types'
import type { CohortSearchParams, CohortVariant } from '../../../shared/types/cohort'
import { mainLogger } from '../../services/MainLogger'
import {
  CaseIdSchema,
  VariantFilterPartialSchema,
  CohortSearchParamsSchema
} from '../../../shared/types/ipc-schemas'

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

// Column headers for Excel export (human-readable)
const EXPORT_COLUMNS = [
  { key: 'chr', header: 'Chromosome' },
  { key: 'pos', header: 'Position' },
  { key: 'ref', header: 'Reference' },
  { key: 'alt', header: 'Alternate' },
  { key: 'gt_num', header: 'Genotype' },
  { key: 'gene_symbol', header: 'Gene' },
  { key: 'func', header: 'Function' },
  { key: 'consequence', header: 'Impact' },
  { key: 'transcript', header: 'Transcript' },
  { key: 'cdna', header: 'cDNA Change' },
  { key: 'aa_change', header: 'AA Change' },
  { key: 'gnomad_af', header: 'gnomAD AF' },
  { key: 'cadd', header: 'CADD Score' },
  { key: 'qual', header: 'Quality' },
  { key: 'clinvar', header: 'ClinVar' },
  { key: 'hpo_sim_score', header: 'HPO Score' },
  { key: 'moi', header: 'Mode of Inheritance' }
]

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
          `Export handler called with caseId=${validated.data.caseId}, caseName=${validated.data.caseName}, filters=${JSON.stringify(validated.data.filters)}`,
          'export'
        )
        const db = getDb()
        const mainWindow = BrowserWindow.getAllWindows()[0]
        mainLogger.debug(`Main window found: ${mainWindow !== undefined}`, 'export')

        // Check for valid window before showing dialog
        if (mainWindow === undefined || mainWindow.isDestroyed()) {
          mainLogger.warn('Window closed before export dialog, cannot show save dialog', 'export')
          return { success: false, error: 'No window available for export dialog' }
        }

        // Show save dialog
        const defaultFileName = `${validated.data.caseName.replace(/[^a-z0-9]/gi, '_')}_variants.xlsx`
        mainLogger.debug(`Showing save dialog with default filename: ${defaultFileName}`, 'export')
        const result = await dialog.showSaveDialog(mainWindow, {
          title: 'Export Variants to Excel',
          defaultPath: defaultFileName,
          filters: [
            { name: 'Excel Files', extensions: ['xlsx'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        })
        mainLogger.debug(
          `Dialog result: canceled=${result.canceled}, filePath=${result.filePath ?? 'none'}`,
          'export'
        )

        if (result.canceled === true || result.filePath === undefined || result.filePath === '') {
          return { success: false, error: 'Export cancelled' }
        }

        // Get all variants matching the current filters (no pagination)
        const fullFilter: VariantFilter = {
          ...validated.data.filters,
          case_id: validated.data.caseId
        }
        const variants = db.variants.getAllVariantsForExport(fullFilter)

        // Convert variants to worksheet data
        const headers = EXPORT_COLUMNS.map((col) => col.header)
        const rows = variants.map((variant: Variant) =>
          EXPORT_COLUMNS.map((col) => {
            const value = variant[col.key as keyof Variant]
            // Format specific columns
            if (col.key === 'gnomad_af' && typeof value === 'number') {
              return value.toExponential(2)
            }
            if (col.key === 'cadd' && typeof value === 'number') {
              return value.toFixed(2)
            }
            if (col.key === 'hpo_sim_score' && typeof value === 'number') {
              return value.toFixed(4)
            }
            return value ?? ''
          })
        )

        // Create workbook
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])

        // Set column widths
        ws['!cols'] = EXPORT_COLUMNS.map((col) => ({
          wch: col.key === 'aa_change' ? 20 : 15
        }))

        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, 'Variants')

        // Add metadata sheet
        const vFilters = validated.data.filters
        const metaData = [
          ['Export Information'],
          ['Case Name', validated.data.caseName],
          ['Total Variants', variants.length],
          ['Export Date', new Date().toISOString()],
          [''],
          ['Active Filters'],
          ...(vFilters.gene_symbol !== undefined && vFilters.gene_symbol !== ''
            ? [['Gene', vFilters.gene_symbol]]
            : []),
          ...(vFilters.consequences !== undefined && vFilters.consequences.length > 0
            ? [['Consequences', vFilters.consequences.join(', ')]]
            : []),
          ...(vFilters.funcs !== undefined && vFilters.funcs.length > 0
            ? [['Functions', vFilters.funcs.join(', ')]]
            : []),
          ...(vFilters.clinvars !== undefined && vFilters.clinvars.length > 0
            ? [['ClinVar', vFilters.clinvars.join(', ')]]
            : []),
          ...(vFilters.gnomad_af_max !== undefined
            ? [['Max gnomAD AF', vFilters.gnomad_af_max]]
            : []),
          ...(vFilters.cadd_min !== undefined ? [['Min CADD', vFilters.cadd_min]] : [])
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
          ...(validated.data.cohort_frequency_min !== undefined
            ? [
                [
                  'Min Cohort Frequency',
                  `${(validated.data.cohort_frequency_min * 100).toFixed(1)}%`
                ]
              ]
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
