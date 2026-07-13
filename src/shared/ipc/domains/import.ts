import type { ImportResult, VcfPreviewResult, VcfMultiPreviewResult } from '../../types/import'
import type { MultiFileImportResult, MultiFileImportSpec } from '../../types/api'
import type { IpcResult } from '../../types/errors'

export interface ImportDomainContract {
  selectFile: () => Promise<IpcResult<string | null>>
  selectFiles: () => Promise<IpcResult<string[]>>
  selectBedFile: () => Promise<IpcResult<string | null>>
  enrollDroppedFiles: (files: readonly File[]) => Promise<IpcResult<string[]>>
  start: (
    filePath: string,
    caseName: string,
    vcfOptions?: { selectedSample?: string; genomeBuild?: string }
  ) => Promise<IpcResult<ImportResult>>
  startMultiFile: (
    caseName: string,
    files: MultiFileImportSpec[],
    vcfOptions?: { selectedSample?: string; genomeBuild?: string },
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
  vcfMultiPreview: (filePaths: string[]) => Promise<IpcResult<VcfMultiPreviewResult>>
  cancel: () => Promise<IpcResult<void>>
}
