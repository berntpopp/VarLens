import { dialog } from 'electron'
import { dirname } from 'path'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import { safeEmit } from '../utils/safeEmit'
import { loadSettings, saveSettings } from '../utils/settings-io'
import {
  startImport,
  cancelImport,
  getVcfPreview,
  getVcfMultiPreview,
  startMultiFileImport
} from './import-logic'
import type { ImportCallbacks, MultiFileImportSpec } from './import-logic'
import type { ImportFilters } from '../../import/vcf/import-filters'
import { BedFilter } from '../../import/vcf/bed-filter'
import { mainLogger } from '../../services/MainLogger'

/**
 * Serializable filter payload sent from the renderer over IPC.
 *
 * The renderer can't construct a `BedFilter` instance directly (it's a
 * class living in the main process), so it sends a BED file path + padding
 * and the main process builds the filter here.
 */
interface ImportFiltersIpcPayload {
  bedFile?: string | null
  bedPadding?: number
  passOnly?: boolean
  minQual?: number | null
  minGq?: number | null
  minDp?: number | null
}

/**
 * Convert a serialized IPC filter payload into the in-process `ImportFilters`
 * shape expected by `startMultiFileImport` / `VcfStrategy`. Returns undefined
 * when the payload has no meaningful filter content (so the append path can
 * skip the entire filter code path cheaply).
 */
function buildImportFiltersFromIpc(
  payload: ImportFiltersIpcPayload | undefined
): ImportFilters | undefined {
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
    try {
      bedFilter = BedFilter.fromFile(payload.bedFile, payload.bedPadding ?? 0)
    } catch (e) {
      mainLogger.warn(
        `Failed to load BED filter from ${payload.bedFile}: ${
          e instanceof Error ? e.message : String(e)
        }`,
        'import'
      )
    }
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

/** Shared callbacks that wire logic-layer events to renderer via safeEmit. */
const importCallbacks: ImportCallbacks = {
  onProgress: (data) => safeEmit('import:progress', data)
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
        return startImport(filePath, caseName, vcfOptions, getDb, importCallbacks)
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
        const importFilters = buildImportFiltersFromIpc(filtersPayload)
        return startMultiFileImport(
          caseName,
          files,
          vcfOptions,
          getDb,
          importCallbacks,
          importFilters
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
      return getVcfPreview(filePath)
    })
  })

  ipcMain.handle('import:vcfMultiPreview', async (_event, filePaths: string[]) => {
    return wrapHandler(async () => {
      return getVcfMultiPreview(filePaths)
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
      return result.filePaths[0]
    })
  })
}
