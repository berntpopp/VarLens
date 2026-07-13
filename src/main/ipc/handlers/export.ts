import { dialog, BrowserWindow, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import { mainLogger } from '../../services/MainLogger'
import {
  addAllowedExportRevealPath,
  isAllowedExportRevealPath
} from '../../security/export-path-allowlist'
import { FilePathSchema } from '../../../shared/types/ipc-schemas'
import { InvalidParametersError } from '../errors'
import {
  CohortSearchParamsSchema,
  VariantExportParamsSchema
} from '../../../shared/api/schemas/export'
import { safeEmit } from '../utils/safeEmit'
import {
  prepareVariantExport,
  exportVariants,
  exportCohort,
  exportPostgresVariants,
  exportPostgresCohort
} from './export-logic'
import type { ExportCallbacks } from './export-logic'

const AUTOMATED_EXPORT_DIR_ENV = 'VARLENS_AUTOMATED_EXPORT_DIR'

function automatedExportPath(defaultFileName: string): string | null {
  const dir = process.env[AUTOMATED_EXPORT_DIR_ENV]
  if (dir === undefined || dir.trim() === '') return null
  mkdirSync(dir, { recursive: true })
  const safeName = defaultFileName.replace(/[^a-zA-Z0-9._-]/g, '_')
  return join(dir, `${randomUUID()}-${safeName}`)
}

/**
 * Export IPC handlers
 * Channels: export:variants, export:cohort
 */
export function registerExportHandlers({
  ipcMain,
  getDb,
  getDbManager
}: HandlerDependencies): void {
  ipcMain.handle('export:revealInFolder', async (_event, filePath: unknown) => {
    return wrapHandler(async () => {
      const validated = FilePathSchema.safeParse(filePath)
      if (!validated.success) {
        throw new InvalidParametersError(
          `Invalid export:revealInFolder params: ${validated.error.message}`
        )
      }
      if (!isAllowedExportRevealPath(validated.data)) {
        throw new InvalidParametersError(
          `export:revealInFolder: path has no successful export authority: ${validated.data}`,
          'The exported file is no longer available to reveal.'
        )
      }
      shell.showItemInFolder(validated.data)
      return { success: true }
    })
  })

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

        const session = getDbManager().getCurrentSession()
        const isPostgres = session.capabilities.backend === 'postgres'

        // Pre-check count/limit BEFORE showing save dialog to avoid
        // the user picking a file path only to be told the export is too large.
        const preparation = isPostgres
          ? null
          : prepareVariantExport(getDb, validated.data.caseId, validated.data.filters)
        if (preparation !== null && 'success' in preparation) {
          return preparation
        }

        const defaultFileName = `${validated.data.caseName.replace(/[^a-z0-9]/gi, '_')}_variants.${isPostgres ? 'csv' : 'xlsx'}`
        let outputFilePath = automatedExportPath(defaultFileName)
        const mainWindow = BrowserWindow.getAllWindows()[0]

        if (outputFilePath === null) {
          if (mainWindow === undefined || mainWindow.isDestroyed()) {
            return { success: false, error: 'No window available for export dialog' }
          }

          const result = await dialog.showSaveDialog(mainWindow, {
            title: isPostgres ? 'Export Variants to CSV' : 'Export Variants to Excel',
            defaultPath: defaultFileName,
            filters: isPostgres
              ? [
                  { name: 'CSV Files', extensions: ['csv'] },
                  { name: 'All Files', extensions: ['*'] }
                ]
              : [
                  { name: 'Excel Files', extensions: ['xlsx'] },
                  { name: 'All Files', extensions: ['*'] }
                ]
          })

          if (result.canceled === true || result.filePath === undefined || result.filePath === '') {
            return { success: false, error: 'Export cancelled' }
          }
          outputFilePath = result.filePath
        }

        /** Wire progress events to renderer via safeEmit. */
        const exportCallbacks: ExportCallbacks = {
          onProgress: (data) => {
            if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
              safeEmit('export:progress', data)
            }
          }
        }

        if (isPostgres) {
          const rows = (await session.getReadExecutor().execute({
            type: 'export:variants',
            params: [
              {
                ...validated.data.filters,
                case_id: validated.data.caseId
              }
            ]
          })) as AsyncIterable<Record<string, unknown>>
          const result = await exportPostgresVariants(rows, outputFilePath, exportCallbacks)
          if (result.success) addAllowedExportRevealPath(outputFilePath)
          return result
        }

        if (preparation === null) {
          throw new Error('SQLite export preparation was not created')
        }

        const result = await exportVariants(
          getDb,
          preparation.compiled,
          validated.data.filters,
          validated.data.caseName,
          outputFilePath,
          exportCallbacks
        )
        if (result.success) addAllowedExportRevealPath(outputFilePath)
        return result
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
        const session = getDbManager().getCurrentSession()
        const isPostgres = session.capabilities.backend === 'postgres'
        const defaultFileName = `cohort_variants_${new Date().toISOString().slice(0, 10)}.${isPostgres ? 'csv' : 'xlsx'}`
        let outputFilePath = automatedExportPath(defaultFileName)
        const mainWindow = BrowserWindow.getAllWindows()[0]

        if (outputFilePath === null) {
          if (mainWindow === undefined || mainWindow.isDestroyed()) {
            mainLogger.warn(
              'Window closed before cohort export dialog, cannot show save dialog',
              'export'
            )
            return { success: false, error: 'No window available for export dialog' }
          }

          const result = await dialog.showSaveDialog(mainWindow, {
            title: isPostgres ? 'Export Cohort Variants to CSV' : 'Export Cohort Variants to Excel',
            defaultPath: defaultFileName,
            filters: isPostgres
              ? [
                  { name: 'CSV Files', extensions: ['csv'] },
                  { name: 'All Files', extensions: ['*'] }
                ]
              : [
                  { name: 'Excel Files', extensions: ['xlsx'] },
                  { name: 'All Files', extensions: ['*'] }
                ]
          })

          if (result.canceled === true || result.filePath === undefined || result.filePath === '') {
            return { success: false, error: 'Export cancelled' }
          }
          outputFilePath = result.filePath
        }

        /** Wire progress events to renderer via safeEmit. */
        const exportCallbacks: ExportCallbacks = {
          onProgress: (data) => {
            if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
              safeEmit('export:progress', data)
            }
          }
        }

        if (isPostgres) {
          const rows = (await session.getReadExecutor().execute({
            type: 'export:cohort',
            params: [validated.data]
          })) as AsyncIterable<Record<string, unknown>>
          const result = await exportPostgresCohort(rows, outputFilePath, exportCallbacks)
          if (result.success) addAllowedExportRevealPath(outputFilePath)
          return result
        }

        const result = await exportCohort(getDb, validated.data, outputFilePath)
        if (result.success) addAllowedExportRevealPath(outputFilePath)
        return result
      }) as Promise<{ success: boolean; filePath?: string; error?: string }>
    }
  )
}
