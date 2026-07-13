import { dialog } from 'electron'
import { dirname, join } from 'path'
import { readdir } from 'fs/promises'
import type { HandlerDependencies } from '../types'
import { ZipExtractor } from '../../import'
import { mainLogger } from '../../services/MainLogger'
import { wrapHandler } from '../errorHandler'
import { InvalidParametersError } from '../errors'
import { loadSettings, saveSettings } from '../utils/settings-io'
import { safeEmit } from '../utils/safeEmit'
import {
  addAllowedImportPath,
  isStrictlyEnrolledPath,
  removeAllowedImportPath
} from '../../security/import-path-allowlist'
import {
  BatchImportCheckDuplicatesParamsSchema,
  BatchImportExtractZipParamsSchema,
  BatchImportStartParamsSchema,
  BatchImportTestZipPasswordParamsSchema
} from '../../../shared/ipc/domains/batch-import-schemas'
import {
  checkDuplicateFiles,
  startBatchImport,
  cancelBatchImport,
  testZipPassword,
  extractZip,
  cleanupZipTemp
} from './batch-import-logic'
import type { BatchImportCallbacks } from './batch-import-logic'

function throwUnallowedBatchPath(channel: string, filePath: string, label = 'filePath'): never {
  throw new InvalidParametersError(
    `${channel}: ${label} is not in the allowed import paths: ${filePath}`,
    'The selected file is not in an allowed location.'
  )
}

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

      for (const p of result.filePaths) {
        addAllowedImportPath(p)
      }

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

        // The user only picked the containing folder via a dialog, not each
        // file individually — enroll every file discovered inside it so the
        // later checkDuplicates/start calls (which validate against the
        // allowlist) accept them.
        for (const f of files) {
          addAllowedImportPath(f)
        }

        return files
      } catch (error) {
        mainLogger.error(`Failed to read directory: ${error}`, 'import')
        return []
      }
    })
  })

  /**
   * Check which files have duplicate case names in the database.
   */
  ipcMain.handle(
    'batch-import:checkDuplicates',
    async (_event, filePaths: unknown, stripText?: unknown) => {
      return wrapHandler(async () => {
        const parsed = BatchImportCheckDuplicatesParamsSchema.safeParse([filePaths, stripText])
        if (!parsed.success) {
          throw new InvalidParametersError(
            `Invalid batch-import:checkDuplicates params: ${parsed.error.message}`
          )
        }
        const [validatedFilePaths, validatedStripText] = parsed.data
        validatedFilePaths.forEach((filePath, index) => {
          if (!isStrictlyEnrolledPath(filePath)) {
            throwUnallowedBatchPath('batch-import:checkDuplicates', filePath, `filePaths[${index}]`)
          }
        })
        return checkDuplicateFiles(getDb, validatedFilePaths, validatedStripText)
      })
    }
  )

  /**
   * Start batch import with a pre-determined duplicate strategy.
   */
  ipcMain.handle(
    'batch-import:start',
    async (_event, filePaths: unknown, duplicateStrategy: unknown, stripText?: unknown) => {
      return wrapHandler(async () => {
        const parsed = BatchImportStartParamsSchema.safeParse([
          filePaths,
          duplicateStrategy,
          stripText
        ])
        if (!parsed.success) {
          throw new InvalidParametersError(
            `Invalid batch-import:start params: ${parsed.error.message}`
          )
        }
        const [validatedFilePaths, validatedStrategy, validatedStripText] = parsed.data
        validatedFilePaths.forEach((filePath, index) => {
          if (!isStrictlyEnrolledPath(filePath)) {
            throwUnallowedBatchPath('batch-import:start', filePath, `filePaths[${index}]`)
          }
        })
        return startBatchImport(
          getDb,
          validatedFilePaths,
          validatedStrategy,
          validatedStripText,
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
        addAllowedImportPath(filePath)

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
    async (_event, zipPath: unknown, password: unknown) => {
      return wrapHandler(async () => {
        const parsed = BatchImportTestZipPasswordParamsSchema.safeParse([zipPath, password])
        if (!parsed.success) {
          throw new InvalidParametersError(
            `Invalid batch-import:testZipPassword params: ${parsed.error.message}`
          )
        }
        const [validatedZipPath, validatedPassword] = parsed.data
        if (!isStrictlyEnrolledPath(validatedZipPath)) {
          throwUnallowedBatchPath('batch-import:testZipPassword', validatedZipPath, 'zipPath')
        }
        return testZipPassword(validatedZipPath, validatedPassword)
      })
    }
  )

  ipcMain.handle(
    'batch-import:extractZip',
    async (_event, zipPath: unknown, password?: unknown) => {
      return wrapHandler(async () => {
        const parsed = BatchImportExtractZipParamsSchema.safeParse([zipPath, password])
        if (!parsed.success) {
          throw new InvalidParametersError(
            `Invalid batch-import:extractZip params: ${parsed.error.message}`
          )
        }
        const [validatedZipPath, validatedPassword] = parsed.data
        if (!isStrictlyEnrolledPath(validatedZipPath)) {
          throwUnallowedBatchPath('batch-import:extractZip', validatedZipPath, 'zipPath')
        }
        return extractZip(
          validatedZipPath,
          validatedPassword,
          addAllowedImportPath,
          removeAllowedImportPath
        )
      })
    }
  )

  ipcMain.handle('batch-import:cleanupZipTemp', async () => {
    return wrapHandler(async () => {
      cleanupZipTemp()
    })
  })
}
