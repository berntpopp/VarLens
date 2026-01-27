import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { wrapHandler } from '../errorHandler'
import { getDatabaseService } from '../../database'
import { ImportService } from '../../import'
import type { ProgressUpdate } from '../../import/types'

/**
 * Import IPC handlers
 * Channels: import:selectFile, import:start, import:progress, import:cancel
 */

// Track current import for cancellation
let currentAbortController: AbortController | null = null

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

ipcMain.handle('import:selectFile', async () => {
  const settings = loadSettings()

  const result = await dialog.showOpenDialog({
    title: 'Select Variant File',
    defaultPath: settings.lastImportDirectory,
    properties: ['openFile'],
    filters: [
      { name: 'JSON Files', extensions: ['json', 'json.gz', 'gz'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })

  if (result.canceled === true || result.filePaths.length === 0) {
    return null
  }

  // Save directory for next time
  const filePath = result.filePaths[0]
  const directory = filePath.substring(0, filePath.lastIndexOf('/'))
  saveSettings({ ...settings, lastImportDirectory: directory })

  return filePath
})

ipcMain.handle('import:start', async (_event, filePath: string, caseName: string) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    const importService = new ImportService(db)

    // Create abort controller for cancellation
    currentAbortController = new AbortController()

    // Get main window for progress events
    const mainWindow = BrowserWindow.getAllWindows()[0]

    // Throttled progress emitter
    let lastEmitTime = 0

    const onProgress = (progress: ProgressUpdate): void => {
      const now = Date.now()
      if (now - lastEmitTime >= PROGRESS_THROTTLE_MS) {
        lastEmitTime = now
        mainWindow?.webContents.send('import:progress', progress)
      }
    }

    try {
      const result = await importService.importVariants(filePath, {
        caseName,
        onProgress,
        signal: currentAbortController.signal
      })

      // Send final progress (100%)
      mainWindow?.webContents.send('import:progress', {
        phase: 'inserting',
        count: result.variantCount,
        elapsed: result.elapsed
      } as ProgressUpdate)

      return result
    } finally {
      currentAbortController = null
    }
  })
})

ipcMain.handle('import:cancel', async () => {
  if (currentAbortController !== null) {
    currentAbortController.abort()
    currentAbortController = null
  }
})
