import { dialog, BrowserWindow, app } from 'electron'
import { join, dirname } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import { ImportService } from '../../import'
import type { ProgressUpdate } from '../../import/types'
import { mainLogger } from '../../services/MainLogger'
import { API_CONFIG } from '../../../shared/config/api.config'

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
    mainLogger.error(`Failed to save settings: ${error}`, 'import')
  }
}

const PROGRESS_THROTTLE_MS = API_CONFIG.PROGRESS_THROTTLE_MS

export function registerImportHandlers({ ipcMain, getDb }: HandlerDependencies): void {
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
    saveSettings({ ...settings, lastImportDirectory: dirname(filePath) })

    return filePath
  })

  ipcMain.handle('import:start', async (_event, filePath: string, caseName: string) => {
    return wrapHandler(async () => {
      const db = getDb()
      const importService = new ImportService(db)

      // Create abort controller for cancellation
      currentAbortController = new AbortController()

      // Null-safe progress emitter - logs warning if window closed during import
      // Import operation continues to completion even if window closes
      const emitProgress = (progress: ProgressUpdate): void => {
        const win = BrowserWindow.getAllWindows()[0]
        if (win === undefined || win.isDestroyed()) {
          mainLogger.warn('Window closed during import, skipping progress update', 'import')
          return
        }
        win.webContents.send('import:progress', progress)
      }

      // Throttled progress emitter
      let lastEmitTime = 0

      const onProgress = (progress: ProgressUpdate): void => {
        const now = Date.now()
        if (now - lastEmitTime >= PROGRESS_THROTTLE_MS) {
          lastEmitTime = now
          emitProgress(progress)
        }
      }

      try {
        const result = await importService.importVariants(filePath, {
          caseName,
          onProgress,
          signal: currentAbortController.signal
        })

        // Send final progress (100%)
        emitProgress({
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
}
