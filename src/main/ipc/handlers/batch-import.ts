import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { wrapHandler } from '../errorHandler'
import { getDatabaseService } from '../../database'
import { ImportService, BatchImportService } from '../../import'
import type {
  BatchProgress,
  BatchResult,
  DuplicateChoice,
  DuplicatePrompt
} from '../../../shared/types/api'
import type { ProgressUpdate } from '../../import/types'

/**
 * Batch Import IPC handlers
 * Channels: batch-import:selectFiles, batch-import:selectFolder, batch-import:start,
 *           batch-import:cancel, batch-import:resolveDuplicate
 * Events: batch-import:progress, batch-import:duplicatePrompt
 */

// Track current batch import for cancellation
let currentBatchAbortController: AbortController | null = null

// Pending duplicate resolution promise
let pendingDuplicateResolve:
  | ((value: { choice: DuplicateChoice; applyToAll: boolean }) => void)
  | null = null

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
        // Match .json, .json.gz, or .gz files
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
 * Start batch import
 */
ipcMain.handle('batch-import:start', async (_event, filePaths: string[]) => {
  return wrapHandler(async () => {
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

        const batchProgress: BatchProgress = {
          currentIndex: progress.currentIndex,
          totalFiles: progress.totalFiles,
          currentFileName: progress.fileName,
          overallPercent: progress.overallPercent
        }

        mainWindow?.webContents.send('batch-import:progress', batchProgress)
      }
    }

    // Throttled file progress emitter
    let lastFileEmitTime = 0
    let currentFileProgress: ProgressUpdate | undefined

    const onFileProgress = (progress: ProgressUpdate): void => {
      currentFileProgress = progress

      const now = Date.now()
      if (now - lastFileEmitTime >= PROGRESS_THROTTLE_MS) {
        lastFileEmitTime = now

        // Emit batch progress with file progress included
        if (mainWindow !== undefined) {
          mainWindow.webContents.send('batch-import:progress', {
            currentIndex: 0, // Will be updated by batch progress
            totalFiles: filePaths.length,
            currentFileName: '',
            overallPercent: 0,
            fileProgress: currentFileProgress
          } as BatchProgress)
        }
      }
    }

    // Duplicate prompt handler
    const onDuplicateFound = async (
      fileName: string,
      caseName: string
    ): Promise<{ choice: DuplicateChoice; applyToAll: boolean }> => {
      return new Promise((resolve) => {
        // Store resolve function for later call
        pendingDuplicateResolve = resolve

        // Send prompt to renderer
        const prompt: DuplicatePrompt = { fileName, caseName }
        mainWindow?.webContents.send('batch-import:duplicatePrompt', prompt)
      })
    }

    try {
      const result: BatchResult = await batchImportService.processBatch(filePaths, {
        onBatchProgress,
        onFileProgress,
        onDuplicateFound,
        signal: currentBatchAbortController.signal
      })

      // Send final progress (100%)
      mainWindow?.webContents.send('batch-import:progress', {
        currentIndex: filePaths.length,
        totalFiles: filePaths.length,
        currentFileName: '',
        overallPercent: 100
      } as BatchProgress)

      return result
    } finally {
      currentBatchAbortController = null
      pendingDuplicateResolve = null
    }
  })
})

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
 * Resolve duplicate choice
 */
ipcMain.handle(
  'batch-import:resolveDuplicate',
  async (_event, choice: DuplicateChoice, applyToAll: boolean) => {
    if (pendingDuplicateResolve !== null) {
      pendingDuplicateResolve({ choice, applyToAll })
      pendingDuplicateResolve = null
    }
  }
)
