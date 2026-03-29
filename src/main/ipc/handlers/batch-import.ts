import { dialog, BrowserWindow } from 'electron'
import { dirname, basename, join } from 'path'
import { readdir } from 'fs/promises'
import type { HandlerDependencies } from '../types'
import { ZipExtractor, TempDirectoryManager } from '../../import'
import { checkDuplicates } from '../../import/batch-utils'
import { ImportWorkerClient } from '../../workers/import-worker-client'
import type { DuplicateChoice } from '../../../shared/types/api'
import { mainLogger } from '../../services/MainLogger'
import { API_CONFIG } from '../../../shared/config'
import { wrapHandler } from '../errorHandler'
import { loadSettings, saveSettings } from '../utils/settings-io'

// Track current batch import for cancellation
let workerClient: ImportWorkerClient | null = null

// ZIP extraction utilities
const zipExtractor = new ZipExtractor()
let zipTempManager: TempDirectoryManager | null = null

function safeEmit(channel: string, data: unknown): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (win === undefined || win.isDestroyed()) {
    mainLogger.warn(`Window closed during batch import, skipping ${channel}`, 'import')
    return
  }
  win.webContents.send(channel, data)
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

      try {
        const entries = await readdir(folderPath, { withFileTypes: true })

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
  })

  /**
   * Check which files have duplicate case names in the database.
   * Stays on main thread — lightweight DB read.
   */
  ipcMain.handle(
    'batch-import:checkDuplicates',
    async (_event, filePaths: string[], stripText?: string) => {
      return wrapHandler(async () => {
        try {
          const db = getDb()
          const result = checkDuplicates(db, filePaths, stripText)

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
      })
    }
  )

  /**
   * Start batch import with a pre-determined duplicate strategy.
   * Delegates to import worker thread.
   */
  ipcMain.handle(
    'batch-import:start',
    async (_event, filePaths: string[], duplicateStrategy: DuplicateChoice, stripText?: string) => {
      return wrapHandler(async () => {
        try {
          const db = getDb()

          if (workerClient?.isRunning === true) {
            throw new Error('A batch import is already in progress')
          }

          safeEmit('cohort:summaryRebuilt', { is_stale: true })

          // Build FileImportRequest array with duplicate info
          const checkResult = checkDuplicates(db, filePaths, stripText)

          const files = checkResult.files.map((f) => ({
            filePath: f.filePath,
            caseName: f.caseName,
            isDuplicate: f.isDuplicate,
            duplicateStrategy
          }))

          workerClient = new ImportWorkerClient()

          return await new Promise((resolve, reject) => {
            workerClient!.start({
              files,
              dbPath: db.getPath(),
              encryptionKey: db.getEncryptionKey(),
              throttleMs: API_CONFIG.PROGRESS_THROTTLE_MS,
              onProgress: (msg) => {
                safeEmit('batch-import:progress', {
                  currentIndex: msg.fileIndex,
                  totalFiles: msg.totalFiles,
                  currentFileName: msg.fileName,
                  overallPercent: msg.overallPercent,
                  fileProgress: {
                    phase: msg.phase,
                    count: msg.variantCount,
                    elapsed: 0,
                    skipped: msg.skipped
                  }
                })
              },
              onFileComplete: () => {
                // File complete — progress already sent via onProgress
              },
              onComplete: (msg) => {
                workerClient = null

                // Update internal variant frequency counts for successful imports
                // NOTE: Overwritten cases are deleted inside the import worker thread
                // which doesn't have access to decrementFrequencies(). A full frequency
                // recompute may be needed if overwrites occurred. This is a known limitation
                // that will be addressed when the import worker is refactored.
                try {
                  for (const detail of msg.results.details) {
                    if (detail.status === 'success' && detail.caseName) {
                      const c = db.cases.getCaseByName(detail.caseName)
                      db.variants.updateFrequencies(c.id)
                    }
                  }
                } catch (freqError) {
                  mainLogger.warn(
                    `Failed to update variant frequencies: ${freqError}`,
                    'batch-import'
                  )
                }

                // Send final progress
                safeEmit('batch-import:progress', {
                  currentIndex: msg.results.details.length,
                  totalFiles: msg.results.details.length,
                  currentFileName: '',
                  overallPercent: 100
                })

                safeEmit('cohort:summaryRebuilt', { is_stale: false })

                // Build a plain-data result object. Use JSON round-trip to
                // guarantee structured-clone compatibility (worker messages
                // can carry prototype chains or undefined values that fail
                // Electron's IPC serialization on some platforms).
                const batchResult = JSON.parse(
                  JSON.stringify({
                    succeeded: msg.results.succeeded,
                    failed: msg.results.failed,
                    skipped: msg.results.skipped,
                    cancelled: msg.results.cancelled,
                    details: msg.results.details.map((d) => ({
                      filePath: d.filePath,
                      fileName: d.fileName,
                      status: d.status,
                      caseName: d.caseName,
                      variantCount: d.variantCount,
                      error: d.error
                    }))
                  })
                )

                // Notify renderer globally that import completed
                // (even if BatchImportDialog was closed via "Continue in Background")
                safeEmit('batch-import:complete', batchResult)

                resolve(batchResult)
              },
              onError: (msg) => {
                if (msg.fileIndex === -1) {
                  // Fatal error
                  workerClient = null
                  reject(new Error(msg.error))
                }
              }
            })
          })
        } catch (error) {
          workerClient = null
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
      })
    }
  )

  ipcMain.handle('batch-import:cancel', async () => {
    return wrapHandler(async () => {
      if (workerClient !== null) {
        workerClient.cancel()
      }
    })
  })

  ipcMain.handle('batch-import:selectZip', async () => {
    return wrapHandler(async () => {
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
        return null
      }
    })
  })

  ipcMain.handle(
    'batch-import:testZipPassword',
    async (_event, zipPath: string, password: string) => {
      return wrapHandler(async () => {
        try {
          const success = zipExtractor.testPassword(zipPath, password)
          return { success }
        } catch (error) {
          mainLogger.error(`batch-import:testZipPassword error: ${error}`, 'import')
          return { success: false }
        }
      })
    }
  )

  ipcMain.handle('batch-import:extractZip', async (_event, zipPath: string, password?: string) => {
    return wrapHandler(async () => {
      try {
        if (zipTempManager !== null) {
          zipTempManager.cleanup()
        }

        zipTempManager = new TempDirectoryManager()
        const targetDir = zipTempManager.create()

        const result = await zipExtractor.extract(zipPath, targetDir, password)

        return JSON.parse(
          JSON.stringify({
            files: result.extractedFiles,
            errors: result.errors
          })
        )
      } catch (error) {
        mainLogger.error(`batch-import:extractZip error: ${error}`, 'import')
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
  })

  ipcMain.handle('batch-import:cleanupZipTemp', async () => {
    return wrapHandler(async () => {
      if (zipTempManager !== null) {
        zipTempManager.cleanup()
        zipTempManager = null
      }
    })
  })
}
