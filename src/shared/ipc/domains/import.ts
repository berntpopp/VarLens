import type {
  ImportResult,
  JsonFieldPreviewResult,
  VcfPreviewResult,
  VcfMultiPreviewResult
} from '../../types/import'
import type { ImportFieldProfile } from '../../config/import-fields.config'
import type { MultiFileImportResult, MultiFileImportSpec } from '../../types/api'
import type { IpcResult } from '../../types/errors'

/** Import options; `fieldProfile` applies to JSON as well as VCF. */
export interface ImportStartOptions {
  selectedSample?: string
  genomeBuild?: string
  fieldProfile?: ImportFieldProfile
}

export interface ImportDomainContract {
  selectFile: () => Promise<IpcResult<string | null>>
  selectFiles: () => Promise<IpcResult<string[]>>
  selectBedFile: () => Promise<IpcResult<string | null>>
  enrollDroppedFiles: (files: readonly File[]) => Promise<IpcResult<string[]>>
  start: (
    filePath: string,
    caseName: string,
    vcfOptions?: ImportStartOptions
  ) => Promise<IpcResult<ImportResult>>
  startMultiFile: (
    caseName: string,
    files: MultiFileImportSpec[],
    vcfOptions?: ImportStartOptions,
    filters?: {
      bedFile?: string | null
      bedPadding?: number
      passOnly?: boolean
      minQual?: number | null
      minGq?: number | null
      minDp?: number | null
    }
  ) => Promise<IpcResult<MultiFileImportResult>>
  vcfPreview: (filePath: string) => Promise<IpcResult<VcfPreviewResult>>
  /** Fields of the first variants of a JSON export (spec §16 field table). */
  jsonPreview: (filePath: string) => Promise<IpcResult<JsonFieldPreviewResult>>
  vcfMultiPreview: (filePaths: string[]) => Promise<IpcResult<VcfMultiPreviewResult>>
  cancel: () => Promise<IpcResult<void>>
}
