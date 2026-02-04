import { ipcMain, dialog, BrowserWindow } from 'electron'
import * as XLSX from 'xlsx'
import { writeFile } from 'fs/promises'
import { wrapHandler } from '../errorHandler'
import { getDatabaseService } from '../../database'
import type { Variant, VariantFilter } from '../../database/types'

/**
 * Export IPC handlers
 * Channels: export:variants
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

ipcMain.handle(
  'export:variants',
  async (
    _event,
    caseId: number,
    filters: Omit<VariantFilter, 'case_id'>,
    caseName: string
  ): Promise<{ success: boolean; filePath?: string; error?: string }> => {
    console.log('Export handler called with:', { caseId, filters, caseName })
    return wrapHandler(async () => {
      const db = getDatabaseService()
      const mainWindow = BrowserWindow.getAllWindows()[0]
      console.log('Main window found:', mainWindow !== undefined)

      // Show save dialog
      const defaultFileName = `${caseName.replace(/[^a-z0-9]/gi, '_')}_variants.xlsx`
      console.log('Showing save dialog with default filename:', defaultFileName)
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Export Variants to Excel',
        defaultPath: defaultFileName,
        filters: [
          { name: 'Excel Files', extensions: ['xlsx'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })
      console.log('Dialog result:', result)

      if (result.canceled === true || result.filePath === undefined || result.filePath === '') {
        return { success: false, error: 'Export cancelled' }
      }

      // Get all variants matching the current filters (no pagination)
      const fullFilter: VariantFilter = { ...filters, case_id: caseId }
      const variants = db.getAllVariantsForExport(fullFilter)

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
      const metaData = [
        ['Export Information'],
        ['Case Name', caseName],
        ['Total Variants', variants.length],
        ['Export Date', new Date().toISOString()],
        [''],
        ['Active Filters'],
        ...(filters.gene_symbol !== undefined && filters.gene_symbol !== ''
          ? [['Gene', filters.gene_symbol]]
          : []),
        ...(filters.consequences !== undefined && filters.consequences.length > 0
          ? [['Consequences', filters.consequences.join(', ')]]
          : []),
        ...(filters.funcs !== undefined && filters.funcs.length > 0
          ? [['Functions', filters.funcs.join(', ')]]
          : []),
        ...(filters.clinvars !== undefined && filters.clinvars.length > 0
          ? [['ClinVar', filters.clinvars.join(', ')]]
          : []),
        ...(filters.gnomad_af_max !== undefined ? [['Max gnomAD AF', filters.gnomad_af_max]] : []),
        ...(filters.cadd_min !== undefined ? [['Min CADD', filters.cadd_min]] : [])
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
