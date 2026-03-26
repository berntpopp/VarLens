import { dialog, BrowserWindow } from 'electron'
import { dirname } from 'path'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import { ImportWorkerClient } from '../../workers/import-worker-client'
import { mainLogger } from '../../services/MainLogger'
import { API_CONFIG } from '../../../shared/config/api.config'
import { loadSettings, saveSettings } from '../utils/settings-io'

let workerClient: ImportWorkerClient | null = null

function safeEmit(channel: string, data: unknown): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (win === undefined || win.isDestroyed()) {
    mainLogger.warn(`Window closed during import, skipping ${channel}`, 'import')
    return
  }
  win.webContents.send(channel, data)
}

export function registerImportHandlers({ ipcMain, getDb }: HandlerDependencies): void {
  ipcMain.handle('import:selectFile', async () => {
    return wrapHandler(async () => {
      const settings = await loadSettings()

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

      const filePath = result.filePaths[0]
      await saveSettings({ ...settings, lastImportDirectory: dirname(filePath) })

      return filePath
    })
  })

  ipcMain.handle('import:start', async (_event, filePath: string, caseName: string) => {
    return wrapHandler(async () => {
      const db = getDb()

      if (workerClient?.isRunning === true) {
        throw new Error('An import is already in progress')
      }

      workerClient = new ImportWorkerClient()

      return new Promise((resolve, reject) => {
        let capturedCaseId = 0

        workerClient!.start({
          files: [
            {
              filePath,
              caseName,
              isDuplicate: false,
              duplicateStrategy: 'skip'
            }
          ],
          dbPath: db.getPath(),
          encryptionKey: db.getEncryptionKey(),
          throttleMs: API_CONFIG.PROGRESS_THROTTLE_MS,
          onProgress: (msg) => {
            safeEmit('import:progress', {
              phase: msg.phase === 'finalizing' ? 'inserting' : msg.phase,
              count: msg.variantCount,
              elapsed: 0,
              skipped: msg.skipped
            })
          },
          onFileComplete: (msg) => {
            capturedCaseId = msg.result.caseId
          },
          onComplete: (msg) => {
            workerClient = null
            if (msg.results.cancelled === true) {
              resolve({
                caseId: 0,
                variantCount: 0,
                skipped: 0,
                errors: ['Import cancelled by user'],
                elapsed: 0
              })
              return
            }
            const detail = msg.results.details[0]
            if (detail !== undefined && detail.status === 'success') {
              safeEmit('import:progress', {
                phase: 'inserting',
                count: detail.variantCount ?? 0,
                elapsed: 0,
                skipped: 0
              })
              resolve({
                caseId: capturedCaseId,
                variantCount: detail.variantCount ?? 0,
                skipped: 0,
                errors: [],
                elapsed: 0
              })
            } else {
              reject(new Error(detail?.error ?? 'Import failed'))
            }
          },
          onError: (msg) => {
            if (msg.fileIndex === -1) {
              workerClient = null
              reject(new Error(msg.error))
            }
          }
        })
      })
    })
  })

  ipcMain.handle('import:cancel', async () => {
    return wrapHandler(async () => {
      // Only send cancel — do NOT null out workerClient here.
      // The onComplete callback handles cleanup after the worker responds.
      if (workerClient !== null) {
        workerClient.cancel()
      }
    })
  })
}
