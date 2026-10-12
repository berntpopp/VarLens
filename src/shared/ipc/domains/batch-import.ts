import type { BatchResult, DuplicateCheckResult, DuplicateChoice } from '../../types/api'
import type { IpcResult } from '../../types/errors'
import type { ImportFieldProfile } from '../../config/import-fields.config'

export interface BatchImportDomainContract {
  selectFiles: () => Promise<IpcResult<string[]>>
  selectFolder: () => Promise<IpcResult<string[]>>
  checkDuplicates: (
    filePaths: string[],
    stripText?: string
  ) => Promise<IpcResult<DuplicateCheckResult>>
  start: (
    filePaths: string[],
    duplicateStrategy: DuplicateChoice,
    stripText: string | undefined,
    runId: string,
    options?: { fieldProfile?: ImportFieldProfile }
  ) => Promise<IpcResult<BatchResult>>
  cancel: () => Promise<IpcResult<void>>
  selectZip: () => Promise<IpcResult<{ filePath: string; isEncrypted: boolean } | null>>
  testZipPassword: (zipPath: string, password: string) => Promise<IpcResult<{ success: boolean }>>
  extractZip: (
    zipPath: string,
    password?: string
  ) => Promise<IpcResult<{ files: string[]; errors: string[]; extractionId: string }>>
  cleanupZipTemp: (extractionId: string) => Promise<IpcResult<void>>
}
