import type { IpcResult } from '../../types/errors'
import type { VariantFilter } from '../../types/database'
import type { CohortSearchParams } from '../../types/cohort'

export interface ExportResult {
  success: boolean
  filePath?: string
  error?: string
}

export interface ExportDomainContract {
  variants: (
    caseId: number,
    filters: Omit<VariantFilter, 'case_id'>,
    caseName: string
  ) => Promise<IpcResult<ExportResult>>
  cohort: (params: CohortSearchParams) => Promise<IpcResult<ExportResult>>
  revealInFolder: (filePath: string) => Promise<IpcResult<{ success: boolean }>>
  /**
   * `export:cancel` — stop the running variant/cohort export (the worker is
   * terminated; the pending `variants`/`cohort` call resolves with
   * `{ success: false, error: 'Export cancelled' }`).
   */
  cancel: () => Promise<IpcResult<{ cancelled: boolean }>>
}
