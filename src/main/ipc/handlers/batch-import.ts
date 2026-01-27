import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { getDatabaseService } from '../../database'
import { ImportService, BatchImportService } from '../../import'
import type { DuplicateChoice } from '../../../shared/types/api'
import type { ProgressUpdate } from '../../import/types'

/**
 * Batch Import IPC handlers
 * Channels: batch-import:selectFiles, batch-import:selectFolder,
 *           batch-import:checkDuplicates, batch-import:start, batch-import:cancel
 * Events: batch-import:progress
 */

// Track current batch import for cancellation
let currentBatchAbortController: AbortController | null = null

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
    console.error('Failed to save settings:', error)
  }
}

// Throttle interval for progress updates (ms)
const PROGRESS_THROTTLE_MS = 100

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
  const directory = firstFile.substring(0, firstFile.lastIndexOf('/'))
  saveSettings({ ...settings, lastImportDirectory: directory })

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
    console.error('Failed to read directory:', error)
    return []
  }
})

/**
 * Check which files have duplicate case names in the database.
 * Called before start() so user can review duplicates and choose a strategy.
 */
ipcMain.handle('batch-import:checkDuplicates', async (_event, filePaths: string[]) => {
  try {
    const db = getDatabaseService()
    const importService = new ImportService(db)
    const batchImportService = new BatchImportService(db, importService)
    const result = batchImportService.checkDuplicates(filePaths)

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
    console.error('checkDuplicates error:', error)
    return { files: [], duplicateCount: 0 }
  }
})

/**
 * Start batch import with a pre-determined duplicate strategy
 */
ipcMain.handle(
  'batch-import:start',
  async (_event, filePaths: string[], duplicateStrategy: DuplicateChoice) => {
    try {
      const db = getDatabaseService()
      const importService = new ImportService(db)
      const batchImportService = new BatchImportService(db, importService)

      // Create abort controller for cancellation
      currentBatchAbortController = new AbortController()

      // Get main window for progress events
      const mainWindow = BrowserWindow.getAllWindows()[0]

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

          mainWindow?.webContents.send('batch-import:progress', {
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

          mainWindow?.webContents.send('batch-import:progress', {
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
        onBatchProgress,
        onFileProgress,
        signal: currentBatchAbortController.signal
      })

      currentBatchAbortController = null

      // Send final progress (100%)
      mainWindow?.webContents.send('batch-import:progress', {
        currentIndex: filePaths.length,
        totalFiles: filePaths.length,
        currentFileName: '',
        overallPercent: 100
      })

      // JSON round-trip guarantees IPC serializability
      return JSON.parse(JSON.stringify(result))
    } catch (error) {
      currentBatchAbortController = null
      console.error('batch-import:start error:', error)
      return {
        succeeded: 0,
        failed: filePaths.length,
        skipped: 0,
        cancelled: false,
        details: filePaths.map((fp) => ({
          filePath: fp,
          fileName: fp.split('/').pop() ?? fp.split('\\').pop() ?? 'unknown',
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
