import { dialog, BrowserWindow, app } from 'electron'
import { join, dirname, basename } from 'path'
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'
import type { HandlerDependencies } from '../types'
import { ImportService, BatchImportService, ZipExtractor, TempDirectoryManager } from '../../import'
import type { DuplicateChoice } from '../../../shared/types/api'
import type { ProgressUpdate } from '../../import/types'
import { mainLogger } from '../../services/MainLogger'
import { API_CONFIG } from '../../../shared/config'

/**
 * Batch Import IPC handlers
 * Channels: batch-import:selectFiles, batch-import:selectFolder,
 *           batch-import:checkDuplicates, batch-import:start, batch-import:cancel,
 *           batch-import:selectZip, batch-import:testZipPassword,
 *           batch-import:extractZip, batch-import:cleanupZipTemp
 * Events: batch-import:progress
 */

// Track current batch import for cancellation
let currentBatchAbortController: AbortController | null = null

// ZIP extraction utilities
const zipExtractor = new ZipExtractor()
let zipTempManager: TempDirectoryManager | null = null

// Settings file for persisting last directory
const settingsPath = () => join(app.getPath('userData'), 'settings.json')

interface Settings {
  lastImportDirectory?: string
}

function loadSettings(): Settings {
  try {
    if (existsSync(settingsPath()) === true) {
      return JSON.parse(readFileSync(settingsPath(), 'utf8'))
    }
  } catch {
    // Ignore parse errors, return empty
  }
  return {}
}

function saveSettings(settings: Settings): void {
  try {
    writeFileSync(settingsPath(), JSON.stringify(settings, null, 2))
  } catch (error) {
    mainLogger.error(`Failed to save settings: ${error}`, 'import')
  }
}

// Throttle interval for progress updates (ms)
const PROGRESS_THROTTLE_MS = API_CONFIG.PROGRESS_THROTTLE_MS

export function registerBatchImportHandlers({ ipcMain, getDb }: HandlerDependencies): void {
  /**
   * Select multiple files for batch import
   */
  ipcMain.handle('batch-import:selectFiles', async () => {
    const settings = loadSettings()

    const result = await dialog.showOpenDialog({
      title: 'Select Files to Import',
      defaultPath: settings.lastImportDirectory,
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Variant Files', extensions: ['gz', 'json.gz', 'json'] },
        { name: 'ZIP Archives', extensions: ['zip'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result.canceled === true || result.filePaths.length === 0) {
      return []
    }

    // Save directory for next time (use first file's directory)
    const firstFile = result.filePaths[0]
    saveSettings({ ...settings, lastImportDirectory: dirname(firstFile) })

    return result.filePaths
  })

  /**
   * Select folder and find all JSON.gz files in it
   */
  ipcMain.handle('batch-import:selectFolder', async () => {
    const settings = loadSettings()

    const result = await dialog.showOpenDialog({
      title: 'Select Folder to Import',
      defaultPath: settings.lastImportDirectory,
      properties: ['openDirectory']
    })

    if (result.canceled === true || result.filePaths.length === 0) {
      return []
    }

    const folderPath = result.filePaths[0]

    // Save directory for next time
    saveSettings({ ...settings, lastImportDirectory: folderPath })

    // Read directory and filter for JSON/gz files
    try {
      const entries = readdirSync(folderPath, { withFileTypes: true })

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
    } catch (error) {
      mainLogger.error(`Failed to read directory: ${error}`, 'import')
      return []
    }
  })

  /**
   * Check which files have duplicate case names in the database.
   * Called before start() so user can review duplicates and choose a strategy.
   */
  ipcMain.handle(
    'batch-import:checkDuplicates',
    async (_event, filePaths: string[], stripText?: string) => {
      try {
        const db = getDb()
        const importService = new ImportService(db)
        const batchImportService = new BatchImportService(db, importService)
        const result = batchImportService.checkDuplicates(filePaths, stripText)

        // Return plain object (class instances may fail structured clone)
        return {
          files: result.files.map((f) => ({
            filePath: f.filePath,
            fileName: f.fileName,
            caseName: f.caseName,
            isDuplicate: f.isDuplicate
          })),
          duplicateCount: result.duplicateCount
        }
      } catch (error) {
        mainLogger.error(`checkDuplicates error: ${error}`, 'import')
        return { files: [], duplicateCount: 0 }
      }
    }
  )

  /**
   * Start batch import with a pre-determined duplicate strategy
   */
  ipcMain.handle(
    'batch-import:start',
    async (_event, filePaths: string[], duplicateStrategy: DuplicateChoice, stripText?: string) => {
      try {
        const db = getDb()
        const importService = new ImportService(db)
        const batchImportService = new BatchImportService(db, importService)

        // Create abort controller for cancellation
        currentBatchAbortController = new AbortController()

        // Null-safe emit helper - logs warning if window closed during batch import
        // Import operation continues to completion even if window closes
        const safeEmit = (channel: string, data: unknown): boolean => {
          const win = BrowserWindow.getAllWindows()[0]
          if (win === undefined || win.isDestroyed()) {
            mainLogger.warn(`Window closed during batch import, skipping ${channel}`, 'import')
            return false
          }
          win.webContents.send(channel, data)
          return true
        }

        // Throttled batch progress emitter
        let lastBatchEmitTime = 0

        const onBatchProgress = (progress: {
          currentIndex: number
          totalFiles: number
          fileName: string
          overallPercent: number
        }): void => {
          const now = Date.now()
          if (now - lastBatchEmitTime >= PROGRESS_THROTTLE_MS) {
            lastBatchEmitTime = now

            safeEmit('batch-import:progress', {
              currentIndex: progress.currentIndex,
              totalFiles: progress.totalFiles,
              currentFileName: progress.fileName,
              overallPercent: progress.overallPercent
            })
          }
        }

        // Throttled file progress emitter
        let lastFileEmitTime = 0

        const onFileProgress = (progress: ProgressUpdate): void => {
          const now = Date.now()
          if (now - lastFileEmitTime >= PROGRESS_THROTTLE_MS) {
            lastFileEmitTime = now

            safeEmit('batch-import:progress', {
              currentIndex: 0,
              totalFiles: filePaths.length,
              currentFileName: '',
              overallPercent: 0,
              fileProgress: {
                phase: progress.phase,
                count: progress.count,
                elapsed: progress.elapsed,
                skipped: progress.skipped
              }
            })
          }
        }

        const result = await batchImportService.processBatch(filePaths, {
          duplicateStrategy,
          stripText,
          onBatchProgress,
          onFileProgress,
          signal: currentBatchAbortController.signal
        })

        currentBatchAbortController = null

        // Send final progress (100%)
        safeEmit('batch-import:progress', {
          currentIndex: filePaths.length,
          totalFiles: filePaths.length,
          currentFileName: '',
          overallPercent: 100
        })

        return result
      } catch (error) {
        currentBatchAbortController = null
        mainLogger.error(`batch-import:start error: ${error}`, 'import')
        return {
          succeeded: 0,
          failed: filePaths.length,
          skipped: 0,
          cancelled: false,
          details: filePaths.map((fp) => ({
            filePath: fp,
            fileName: basename(fp) || 'unknown',
            status: 'failed' as const,
            error: error instanceof Error ? error.message : 'Unknown error'
          }))
        }
      }
    }
  )

  /**
   * Cancel current batch import
   */
  ipcMain.handle('batch-import:cancel', async () => {
    if (currentBatchAbortController !== null) {
      currentBatchAbortController.abort()
      currentBatchAbortController = null
    }
  })

  /**
   * Select a ZIP file for batch import
   * Returns { filePath, isEncrypted } or null if cancelled
   */
  ipcMain.handle('batch-import:selectZip', async () => {
    try {
      const settings = loadSettings()

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

      // Save directory for next time
      saveSettings({ ...settings, lastImportDirectory: dirname(filePath) })

      const isEncrypted = zipExtractor.isEncrypted(filePath)

      return { filePath, isEncrypted }
    } catch (error) {
      mainLogger.error(`batch-import:selectZip error: ${error}`, 'import')
      return null
    }
  })

  /**
   * Test whether a password is correct for a ZIP file
   */
  ipcMain.handle(
    'batch-import:testZipPassword',
    async (_event, zipPath: string, password: string) => {
      try {
        const success = zipExtractor.testPassword(zipPath, password)
        return { success }
      } catch (error) {
        mainLogger.error(`batch-import:testZipPassword error: ${error}`, 'import')
        return { success: false }
      }
    }
  )

  /**
   * Extract a ZIP file to a temp directory
   * Returns { files: string[], errors: string[] }
   */
  ipcMain.handle('batch-import:extractZip', async (_event, zipPath: string, password?: string) => {
    try {
      // Clean up any previous temp directory
      if (zipTempManager !== null) {
        zipTempManager.cleanup()
      }

      zipTempManager = new TempDirectoryManager()
      const targetDir = zipTempManager.create()

      const result = zipExtractor.extract(zipPath, targetDir, password)

      return JSON.parse(
        JSON.stringify({
          files: result.extractedFiles,
          errors: result.errors
        })
      )
    } catch (error) {
      mainLogger.error(`batch-import:extractZip error: ${error}`, 'import')
      // Clean up on error
      if (zipTempManager !== null) {
        zipTempManager.cleanup()
        zipTempManager = null
      }
      return {
        files: [],
        errors: [error instanceof Error ? error.message : 'Extraction failed']
      }
    }
  })

  /**
   * Clean up the temporary directory used for ZIP extraction
   */
  ipcMain.handle('batch-import:cleanupZipTemp', async () => {
    if (zipTempManager !== null) {
      zipTempManager.cleanup()
      zipTempManager = null
    }
  })
}
