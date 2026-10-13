import { dialog } from 'electron'
import { basename, dirname, join } from 'path'
import { readdir } from 'fs/promises'
import type { HandlerDependencies } from '../types'
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
  BatchImportCleanupZipParamsSchema,
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
  cleanupZipTemp,
  inspectZip
} from './batch-import-logic'
import {
  cancelActiveSessionBatch,
  checkSessionDuplicates,
  startSessionBatchImport
} from './batch-import-session'
import type { BatchImportCallbacks } from './batch-import-logic'
import { addDetectedBuilds } from '../../import/batch-utils'
import {
  IMPORTABLE_VARIANT_EXTENSIONS,
  isImportableVariantFileName
} from '../../../shared/utils/importable-file'

function throwUnallowedBatchPath(channel: string, filePath: string, label = 'filePath'): never {
  throw new InvalidParametersError(
    `${channel}: ${label} is not in the allowed import paths: ${filePath}`,
    'The selected file is not in an allowed location.'
  )
}

function createBatchImportCallbacks(runId: string): BatchImportCallbacks {
  return {
    onProgress: (data) => safeEmit('batch-import:progress', { ...data, runId }),
    onFileComplete: (data) => safeEmit('batch-import:fileComplete', { ...data, runId }),
    onComplete: (data) => safeEmit('batch-import:complete', { ...data, runId }),
    onCohortStale: (data) => safeEmit('cohort:summaryRebuilt', data)
  }
}

export function registerBatchImportHandlers({
  ipcMain,
  getDb,
  getDbManager
}: HandlerDependencies): void {
  ipcMain.handle('batch-import:selectFiles', async () => {
    return wrapHandler(async () => {
      const settings = await loadSettings()

      const result = await dialog.showOpenDialog({
        title: 'Select Files to Import',
        defaultPath: settings.lastImportDirectory,
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Variant Files', extensions: [...IMPORTABLE_VARIANT_EXTENSIONS] },
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

      // A genuinely empty folder resolves normally with zero filtered entries
      // below. A readdir failure (permission denied, folder removed after
      // selection, etc.) is an infrastructure fault and must not masquerade
      // as an empty folder — let it propagate so wrapHandler structures it.
      const entries = await readdir(folderPath, { withFileTypes: true }).catch((error) => {
        mainLogger.error(`Failed to read directory: ${error}`, 'import')
        throw error
      })

      const files = entries
        .filter((entry) => entry.isFile() === true && isImportableVariantFileName(entry.name))
        .map((entry) => join(folderPath, entry.name))

      // The folder dialog grants authority to the discovered files, not to
      // arbitrary later renderer-supplied children of that directory.
      for (const file of files) {
        addAllowedImportPath(file)
      }

      return files
    })
  })

  /**
   * Check which files have duplicate case names in the database.
   */
  ipcMain.handle(
    'batch-import:checkDuplicates',
    async (_event, filePaths: unknown, stripText?: unknown, detectBuilds?: unknown) => {
      return wrapHandler(async () => {
        const parsed = BatchImportCheckDuplicatesParamsSchema.safeParse([
          filePaths,
          stripText,
          detectBuilds
        ])
        if (!parsed.success) {
          throw new InvalidParametersError(
            `Invalid batch-import:checkDuplicates params: ${parsed.error.message}`
          )
        }
        const [validatedFilePaths, validatedStripText, validatedDetectBuilds] = parsed.data
        validatedFilePaths.forEach((filePath, index) => {
          if (!isStrictlyEnrolledPath(filePath)) {
            throwUnallowedBatchPath('batch-import:checkDuplicates', filePath, `filePaths[${index}]`)
          }
        })
        const session = getDbManager().getCurrentSession()
        const report =
          session.capabilities.backend === 'postgres'
            ? await checkSessionDuplicates(
                session,
                validatedFilePaths.map((filePath) => ({ filePath, fileName: basename(filePath) })),
                validatedStripText
              )
            : checkDuplicateFiles(getDb, validatedFilePaths, validatedStripText)
        if (validatedDetectBuilds !== true) return report
        return { ...report, files: await addDetectedBuilds(report.files, validatedFilePaths) }
      })
    }
  )

  /**
   * Start batch import with a pre-determined duplicate strategy.
   */
  ipcMain.handle(
    'batch-import:start',
    async (
      _event,
      filePaths: unknown,
      duplicateStrategy: unknown,
      stripText: unknown,
      runId: unknown,
      fallbackGenomeBuild?: unknown,
      options?: unknown
    ) => {
      return wrapHandler(async () => {
        const parsed = BatchImportStartParamsSchema.safeParse([
          filePaths,
          duplicateStrategy,
          stripText,
          runId,
          fallbackGenomeBuild,
          options
        ])
        if (!parsed.success) {
          throw new InvalidParametersError(
            `Invalid batch-import:start params: ${parsed.error.message}`
          )
        }
        const [
          validatedFilePaths,
          validatedStrategy,
          validatedStripText,
          validatedRunId,
          validatedFallbackBuild,
          validatedOptions
        ] = parsed.data
        const fieldProfile = validatedOptions?.fieldProfile
        validatedFilePaths.forEach((filePath, index) => {
          if (!isStrictlyEnrolledPath(filePath)) {
            throwUnallowedBatchPath('batch-import:start', filePath, `filePaths[${index}]`)
          }
        })
        const session = getDbManager().getCurrentSession()
        if (session.capabilities.backend === 'postgres') {
          // The SQLite import worker cannot write to Postgres: use the shared
          // session batch (same logic as web mode).
          return startSessionBatchImport({
            files: validatedFilePaths.map((filePath) => ({
              inputPath: filePath,
              storedPath: filePath,
              fileName: basename(filePath)
            })),
            duplicateStrategy: validatedStrategy,
            stripText: validatedStripText,
            fallbackGenomeBuild: validatedFallbackBuild,
            runId: validatedRunId,
            fieldProfile,
            session,
            callbacks: createBatchImportCallbacks(validatedRunId)
          })
        }
        return startBatchImport(
          getDb,
          validatedFilePaths,
          validatedStrategy,
          validatedStripText,
          createBatchImportCallbacks(validatedRunId),
          validatedFallbackBuild,
          fieldProfile
        )
      })
    }
  )

  ipcMain.handle('batch-import:cancel', async () => {
    return wrapHandler(async () => {
      cancelBatchImport()
      // Desktop-on-Postgres batches run as a session job (see batch-import:start).
      cancelActiveSessionBatch()
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
        addAllowedImportPath(filePath)

        const { isEncrypted } = await inspectZip(filePath)
        return { filePath, isEncrypted }
      } catch (error) {
        mainLogger.error(`batch-import:selectZip error: ${error}`, 'import')
        throw error
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

  ipcMain.handle('batch-import:cleanupZipTemp', async (_event, extractionId: unknown) => {
    return wrapHandler(async () => {
      const parsed = BatchImportCleanupZipParamsSchema.safeParse([extractionId])
      if (!parsed.success) {
        throw new InvalidParametersError(
          `Invalid batch-import:cleanupZipTemp params: ${parsed.error.message}`
        )
      }
      cleanupZipTemp(parsed.data[0])
    })
  })
}
