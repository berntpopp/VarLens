import type { BatchResult, DuplicateCheckResult, DuplicateChoice } from '../../types/api'
import type { IpcResult } from '../../types/errors'

export interface BatchImportDomainContract {
  selectFiles: () => Promise<IpcResult<string[]>>
  selectFolder: () => Promise<IpcResult<string[]>>
  /** `detectBuilds` also reads each VCF header for its genome build (first call only). */
  checkDuplicates: (
    filePaths: string[],
    stripText?: string,
    detectBuilds?: boolean
  ) => Promise<IpcResult<DuplicateCheckResult>>
  /** `fallbackGenomeBuild`: the build for files whose header decides none (always JSON). */
  start: (
    filePaths: string[],
    duplicateStrategy: DuplicateChoice,
    stripText: string | undefined,
    runId: string,
    fallbackGenomeBuild?: string
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
