import type { IpcResult } from '../../types/errors'
import type { VariantFilter } from '../../types/database'
import type { CohortSearchParams } from '../../types/cohort'

export interface ExportResult {
  success: boolean
  filePath?: string
  error?: string
}

/**
 * Output format. Desktop picks it from the save dialog's file extension and
 * ignores this; web streams the requested format (CSV default).
 */
export type ExportFormat = 'csv' | 'xlsx'

export interface ExportOptions {
  format?: ExportFormat
}

/**
 * `export:progress` push event. `total` is 0 when the row count is not known
 * up front (streamed exports); `done` marks the final event of a web export.
 */
export interface ExportProgress {
  current: number
  total: number
  done?: boolean
  /** Web only: the download grant this progress belongs to. */
  downloadId?: string
  fileName?: string
}

export interface ExportDomainContract {
  variants: (
    caseId: number,
    filters: Omit<VariantFilter, 'case_id'>,
    caseName: string,
    options?: ExportOptions
  ) => Promise<IpcResult<ExportResult>>
  cohort: (params: CohortSearchParams, options?: ExportOptions) => Promise<IpcResult<ExportResult>>
  revealInFolder: (filePath: string) => Promise<IpcResult<{ success: boolean }>>
  /**
   * `export:cancel` — stop the running variant/cohort export (the worker is
   * terminated; the pending `variants`/`cohort` call resolves with
   * `{ success: false, error: 'Export cancelled' }`).
   */
  cancel: () => Promise<IpcResult<{ cancelled: boolean }>>
}
