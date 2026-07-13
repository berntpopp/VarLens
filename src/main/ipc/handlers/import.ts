import { dialog } from 'electron'
import { statSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import type { z } from 'zod'
import { wrapHandler } from '../errorHandler'
import { InvalidParametersError } from '../errors'
import type { HandlerDependencies } from '../types'
import { safeEmit } from '../utils/safeEmit'
import { loadSettings, saveSettings } from '../utils/settings-io'
import {
  addAllowedImportPath,
  isStrictlyEnrolledPath,
  isTrustedImportPathEnrollmentToken,
  registerTrustedImportPathEnrollmentToken
} from '../../security/import-path-allowlist'
import {
  ImportFiltersIpcPayloadSchema,
  ImportEnrollDroppedFilesParamsSchema,
  ImportRegisterDroppedFileEnrollmentTokenParamsSchema,
  ImportStartMultiFileParamsSchema,
  ImportStartParamsSchema,
  ImportVcfMultiPreviewParamsSchema,
  ImportVcfPreviewParamsSchema
} from '../../../shared/ipc/domains/import-schemas'
import {
  startImport,
  cancelImport,
  getVcfPreview,
  getVcfMultiPreview,
  startMultiFileImport
} from './import-logic'
import type { ImportCallbacks, MultiFileImportSpec } from './import-logic'
import type { ImportFilters } from '../../import/vcf/import-filters'
import type { StorageSession } from '../../storage/session'
import { BedFilter } from '../../import/vcf/bed-filter'
import type { VcfMultiPreviewResult } from '../../../shared/types/import'

/**
 * Serializable filter payload sent from the renderer over IPC.
 *
 * The renderer can't construct a `BedFilter` instance directly (it's a
 * class living in the main process), so it sends a BED file path + padding
 * and the main process builds the filter here.
 */
type ImportFiltersIpcPayload = z.infer<typeof ImportFiltersIpcPayloadSchema>

/**
 * Convert a serialized IPC filter payload into the in-process `ImportFilters`
 * shape expected by `startMultiFileImport` / `VcfStrategy`. Returns undefined
 * when the payload has no meaningful filter content (so the append path can
 * skip the entire filter code path cheaply).
 */
async function buildImportFiltersFromIpc(
  payload: ImportFiltersIpcPayload | undefined
): Promise<ImportFilters | undefined> {
  if (payload === undefined) return undefined

  const hasAny =
    (payload.bedFile !== undefined && payload.bedFile !== null && payload.bedFile !== '') ||
    payload.passOnly === true ||
    (payload.minQual !== undefined && payload.minQual !== null) ||
    (payload.minGq !== undefined && payload.minGq !== null) ||
    (payload.minDp !== undefined && payload.minDp !== null)
  if (!hasAny) return undefined

  let bedFilter: BedFilter | undefined
  if (payload.bedFile !== undefined && payload.bedFile !== null && payload.bedFile !== '') {
    bedFilter = await BedFilter.fromFile(payload.bedFile, payload.bedPadding ?? 0)
  }

  return {
    bedFilter,
    bedPadding: payload.bedPadding ?? 0,
    passOnly: payload.passOnly ?? false,
    minQual: payload.minQual ?? null,
    minGq: payload.minGq ?? null,
    minDp: payload.minDp ?? null
  }
}

function throwUnallowedImportPath(channel: string, filePath: string, label = 'filePath'): never {
  throw new InvalidParametersError(
    `${channel}: ${label} is not in the allowed import paths: ${filePath}`,
    'The selected file is not in an allowed location.'
  )
}

function isSupportedDroppedVcf(filePath: string): boolean {
  if (!isAbsolute(filePath) || resolve(filePath) !== filePath) return false
  const lower = filePath.toLowerCase()
  if (!lower.endsWith('.vcf') && !lower.endsWith('.vcf.gz')) return false
  return isRegularFile(filePath)
}

function isRegularFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile()
  } catch {
    return false
  }
}

function enrollTrustedSiblingBeds(
  preview: VcfMultiPreviewResult,
  selectedVcfPaths: string[]
): void {
  const selectedDirectories = new Set(selectedVcfPaths.map((filePath) => dirname(filePath)))
  for (const bedFile of preview.siblingBedFiles) {
    const lower = bedFile.toLowerCase()
    if (
      isAbsolute(bedFile) &&
      resolve(bedFile) === bedFile &&
      selectedDirectories.has(dirname(bedFile)) &&
      (lower.endsWith('.bed') || lower.endsWith('.bed.gz')) &&
      isRegularFile(bedFile)
    ) {
      addAllowedImportPath(bedFile)
    }
  }
}

/** Shared callbacks that wire logic-layer events to renderer via safeEmit. */
const importCallbacks: ImportCallbacks = {
  onProgress: (data) => safeEmit('import:progress', data)
}

export function registerImportHandlers({
  ipcMain,
  getDb,
  getDbManager
}: HandlerDependencies): void {
  const getSession = (): StorageSession => getDbManager().getCurrentSession()
  ipcMain.handle('import:selectFile', async () => {
    return wrapHandler(async () => {
      const settings = await loadSettings()

      const result = await dialog.showOpenDialog({
        title: 'Select Variant File',
        defaultPath: settings.lastImportDirectory,
        properties: ['openFile'],
        filters: [
          { name: 'Variant Files', extensions: ['vcf', 'json', 'gz'] },
          { name: 'VCF Files', extensions: ['vcf', 'gz'] },
          { name: 'JSON Files', extensions: ['json', 'gz'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })

      if (result.canceled === true || result.filePaths.length === 0) {
        return null
      }

      const filePath = result.filePaths[0]
      for (const p of result.filePaths) {
        addAllowedImportPath(p)
      }
      await saveSettings({ ...settings, lastImportDirectory: dirname(filePath) })

      return filePath
    })
  })

  ipcMain.handle(
    'import:start',
    async (
      _event,
      filePath: string,
      caseName: string,
      vcfOptions?: { selectedSample?: string; genomeBuild?: string }
    ) => {
      return wrapHandler(async () => {
        const parsed = ImportStartParamsSchema.safeParse([filePath, caseName, vcfOptions])
        if (!parsed.success) {
          throw new InvalidParametersError(`Invalid import:start params: ${parsed.error.message}`)
        }

        const [validatedPath, validatedCaseName, validatedOptions] = parsed.data
        if (!isStrictlyEnrolledPath(validatedPath)) {
          throwUnallowedImportPath('import:start', validatedPath)
        }
        return startImport(
          validatedPath,
          validatedCaseName,
          validatedOptions,
          getSession,
          importCallbacks
        )
      })
    }
  )

  ipcMain.handle(
    'import:startMultiFile',
    async (
      _event,
      caseName: string,
      files: MultiFileImportSpec[],
      vcfOptions?: { selectedSample?: string; genomeBuild?: string },
      filtersPayload?: ImportFiltersIpcPayload
    ) => {
      return wrapHandler(async () => {
        const parsed = ImportStartMultiFileParamsSchema.safeParse([
          caseName,
          files,
          vcfOptions,
          filtersPayload
        ])
        if (!parsed.success) {
          throw new InvalidParametersError(
            `Invalid import:startMultiFile params: ${parsed.error.message}`
          )
        }

        const [validatedCaseName, validatedFiles, validatedOptions, validatedFiltersPayload] =
          parsed.data
        validatedFiles.forEach((file, index) => {
          if (!isStrictlyEnrolledPath(file.filePath)) {
            throwUnallowedImportPath(
              'import:startMultiFile',
              file.filePath,
              `files[${index}].filePath`
            )
          }
        })

        const bedFile = validatedFiltersPayload?.bedFile
        if (
          bedFile !== undefined &&
          bedFile !== null &&
          bedFile !== '' &&
          !isStrictlyEnrolledPath(bedFile)
        ) {
          throwUnallowedImportPath('import:startMultiFile', bedFile, 'filtersPayload.bedFile')
        }

        // Build the SQLite-path ImportFilters (loads BedFilter into memory).
        // The PG path receives filtersPayload directly so it can extract the
        // BED file path without going through the BedFilter constructor.
        const importFilters = await buildImportFiltersFromIpc(validatedFiltersPayload)
        return startMultiFileImport(
          validatedCaseName,
          validatedFiles,
          validatedOptions,
          getSession,
          getDb,
          importCallbacks,
          importFilters,
          validatedFiltersPayload
        )
      })
    }
  )

  ipcMain.handle('import:cancel', async () => {
    return wrapHandler(async () => {
      cancelImport()
    })
  })

  ipcMain.handle('import:vcfPreview', async (_event, filePath: string) => {
    return wrapHandler(async () => {
      const parsed = ImportVcfPreviewParamsSchema.safeParse([filePath])
      if (!parsed.success) {
        throw new InvalidParametersError(
          `Invalid import:vcfPreview params: ${parsed.error.message}`
        )
      }

      const [validatedPath] = parsed.data
      if (!isStrictlyEnrolledPath(validatedPath)) {
        throwUnallowedImportPath('import:vcfPreview', validatedPath)
      }
      return getVcfPreview(validatedPath)
    })
  })

  ipcMain.handle('import:vcfMultiPreview', async (_event, filePaths: string[]) => {
    return wrapHandler(async () => {
      const parsed = ImportVcfMultiPreviewParamsSchema.safeParse([filePaths])
      if (!parsed.success) {
        throw new InvalidParametersError(
          `Invalid import:vcfMultiPreview params: ${parsed.error.message}`
        )
      }

      const [validatedPaths] = parsed.data
      validatedPaths.forEach((filePath, index) => {
        if (!isStrictlyEnrolledPath(filePath)) {
          throwUnallowedImportPath('import:vcfMultiPreview', filePath, `filePaths[${index}]`)
        }
      })
      const preview = (await getVcfMultiPreview(validatedPaths)) as VcfMultiPreviewResult
      enrollTrustedSiblingBeds(preview, validatedPaths)
      return preview
    })
  })

  // `window.api.import.enrollDroppedFiles` accepts browser File objects, not
  // strings. Preload converts only genuine Electron-backed Files with
  // webUtils.getPathForFile and attaches a preload-held token before invoking
  // this internal channel.
  ipcMain.handle('import:registerDroppedFileEnrollmentToken', async (_event, token: unknown) => {
    return wrapHandler(async () => {
      const parsed = ImportRegisterDroppedFileEnrollmentTokenParamsSchema.safeParse([token])
      if (!parsed.success) {
        throw new InvalidParametersError(
          `Invalid import:registerDroppedFileEnrollmentToken params: ${parsed.error.message}`
        )
      }
      registerTrustedImportPathEnrollmentToken(parsed.data[0])
    })
  })

  ipcMain.handle('import:enrollDroppedFiles', async (_event, filePaths: unknown) => {
    return wrapHandler(async () => {
      const parsed = ImportEnrollDroppedFilesParamsSchema.safeParse([filePaths])
      if (!parsed.success) {
        throw new InvalidParametersError(
          `Invalid import:enrollDroppedFiles params: ${parsed.error.message}`
        )
      }
      const [payload] = parsed.data
      if (!isTrustedImportPathEnrollmentToken(payload.token)) {
        throw new InvalidParametersError(
          'import:enrollDroppedFiles: missing trusted preload enrollment token'
        )
      }
      const enrolledPaths = payload.filePaths.filter(isSupportedDroppedVcf)
      for (const filePath of enrolledPaths) addAllowedImportPath(filePath)
      return enrolledPaths
    })
  })

  ipcMain.handle('import:selectFiles', async () => {
    return wrapHandler(async () => {
      const settings = await loadSettings()

      const result = await dialog.showOpenDialog({
        title: 'Select VCF Files',
        defaultPath: settings.lastImportDirectory,
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'VCF Files', extensions: ['vcf', 'gz'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })

      if (result.canceled === true || result.filePaths.length === 0) {
        return []
      }

      await saveSettings({ ...settings, lastImportDirectory: dirname(result.filePaths[0]) })
      for (const p of result.filePaths) {
        addAllowedImportPath(p)
      }
      return result.filePaths
    })
  })

  ipcMain.handle('import:selectBedFile', async () => {
    return wrapHandler(async () => {
      const settings = await loadSettings()

      const result = await dialog.showOpenDialog({
        title: 'Select BED Region File',
        defaultPath: settings.lastImportDirectory,
        properties: ['openFile'],
        filters: [
          { name: 'BED Files', extensions: ['bed', 'gz'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })

      if (result.canceled === true || result.filePaths.length === 0) {
        return null
      }

      // Persist the directory so the next BED picker opens in the same place
      // (matches the behavior of import:selectFile / import:selectFiles).
      await saveSettings({ ...settings, lastImportDirectory: dirname(result.filePaths[0]) })
      for (const p of result.filePaths) {
        addAllowedImportPath(p)
      }
      return result.filePaths[0]
    })
  })
}
