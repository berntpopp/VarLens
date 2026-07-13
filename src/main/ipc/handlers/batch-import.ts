import { dialog } from 'electron'
import { dirname, join } from 'path'
import { readdir } from 'fs/promises'
import type { HandlerDependencies } from '../types'
import { ZipExtractor } from '../../import'
import type { DuplicateChoice } from '../../../shared/types/api'
import { mainLogger } from '../../services/MainLogger'
import { wrapHandler } from '../errorHandler'
import { loadSettings, saveSettings } from '../utils/settings-io'
import { safeEmit } from '../utils/safeEmit'
import {
  checkDuplicateFiles,
  startBatchImport,
  cancelBatchImport,
  testZipPassword,
  extractZip,
  cleanupZipTemp
} from './batch-import-logic'
import type { BatchImportCallbacks } from './batch-import-logic'

// ZIP extractor for isEncrypted check (stays in handler — used with dialog)
const zipExtractor = new ZipExtractor()

/** Shared callbacks that wire logic-layer events to renderer via safeEmit. */
const batchImportCallbacks: BatchImportCallbacks = {
  onProgress: (data) => safeEmit('batch-import:progress', data),
  onComplete: (data) => safeEmit('batch-import:complete', data),
  onCohortStale: (data) => safeEmit('cohort:summaryRebuilt', data)
}

export function registerBatchImportHandlers({ ipcMain, getDb }: HandlerDependencies): void {
  ipcMain.handle('batch-import:selectFiles', async () => {
    return wrapHandler(async () => {
      const settings = await loadSettings()

      const result = await dialog.showOpenDialog({
        title: 'Select Files to Import',
        defaultPath: settings.lastImportDirectory,
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Variant Files', extensions: ['gz', 'json.gz', 'json', 'vcf', 'vcf.gz'] },
          { name: 'ZIP Archives', extensions: ['zip'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })

      if (result.canceled === true || result.filePaths.length === 0) {
        return []
      }

      const firstFile = result.filePaths[0]
      await saveSettings({ ...settings, lastImportDirectory: dirname(firstFile) })

      return result.filePaths
    })
  })

  ipcMain.handle('batch-import:selectFolder', async () => {
    return wrapHandler(async () => {
      const settings = await loadSettings()

      const result = await dialog.showOpenDialog({
        title: 'Select Folder to Import',
        defaultPath: settings.lastImportDirectory,
        properties: ['openDirectory']
      })

      if (result.canceled === true || result.filePaths.length === 0) {
        return []
      }

      const folderPath = result.filePaths[0]
      await saveSettings({ ...settings, lastImportDirectory: folderPath })

      // A genuinely empty folder resolves normally with zero filtered entries
      // below. A readdir failure (permission denied, folder removed after
      // selection, etc.) is an infrastructure fault and must not masquerade
      // as an empty folder — let it propagate so wrapHandler structures it.
      const entries = await readdir(folderPath, { withFileTypes: true }).catch((error) => {
        mainLogger.error(`Failed to read directory: ${error}`, 'import')
        throw error
      })

      const files = entries
        .filter((entry) => {
          if (entry.isFile() === false) return false
          const name = entry.name.toLowerCase()
          return (
            name.endsWith('.json') === true ||
            name.endsWith('.json.gz') === true ||
            name.endsWith('.gz') === true
          )
        })
        .map((entry) => join(folderPath, entry.name))

      return files
    })
  })

  /**
   * Check which files have duplicate case names in the database.
   */
  ipcMain.handle(
    'batch-import:checkDuplicates',
    async (_event, filePaths: string[], stripText?: string) => {
      return wrapHandler(async () => {
        return checkDuplicateFiles(getDb, filePaths, stripText)
      })
    }
  )

  /**
   * Start batch import with a pre-determined duplicate strategy.
   */
  ipcMain.handle(
    'batch-import:start',
    async (_event, filePaths: string[], duplicateStrategy: DuplicateChoice, stripText?: string) => {
      return wrapHandler(async () => {
        return startBatchImport(
          getDb,
          filePaths,
          duplicateStrategy,
          stripText,
          batchImportCallbacks
        )
      })
    }
  )

  ipcMain.handle('batch-import:cancel', async () => {
    return wrapHandler(async () => {
      cancelBatchImport()
    })
  })

  ipcMain.handle('batch-import:selectZip', async () => {
    return wrapHandler(async () => {
      // `null` is the legitimate "user cancelled the dialog" outcome, handled
      // explicitly below. A dialog/settings/fs failure is a different, real
      // failure and must not be swallowed into that same `null` — that would
      // be indistinguishable from a cancel and hide a genuine error.
      try {
        const settings = await loadSettings()

        const result = await dialog.showOpenDialog({
          title: 'Select ZIP Archive to Import',
          defaultPath: settings.lastImportDirectory,
          properties: ['openFile'],
          filters: [
            { name: 'ZIP Archives', extensions: ['zip'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        })

        if (result.canceled === true || result.filePaths.length === 0) {
          return null
        }

        const filePath = result.filePaths[0]
        await saveSettings({ ...settings, lastImportDirectory: dirname(filePath) })

        const isEncrypted = zipExtractor.isEncrypted(filePath)
        return { filePath, isEncrypted }
      } catch (error) {
        mainLogger.error(`batch-import:selectZip error: ${error}`, 'import')
        throw error
      }
    })
  })

  ipcMain.handle(
    'batch-import:testZipPassword',
    async (_event, zipPath: string, password: string) => {
      return wrapHandler(async () => {
        return testZipPassword(zipPath, password)
      })
    }
  )

  ipcMain.handle('batch-import:extractZip', async (_event, zipPath: string, password?: string) => {
    return wrapHandler(async () => {
      return extractZip(zipPath, password)
    })
  })

  ipcMain.handle('batch-import:cleanupZipTemp', async (_event, extractionId: unknown) => {
    return wrapHandler(async () => {
      if (typeof extractionId !== 'string' || extractionId.length === 0) {
        throw new Error('Invalid ZIP extraction cleanup authority')
      }
      cleanupZipTemp(extractionId)
    })
  })
}
