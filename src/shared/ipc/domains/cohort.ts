import type {
  CohortSearchParams,
  CohortVariant,
  CohortSummary,
  CohortCarrier,
  GeneBurden
} from '../../types/cohort'
import type { ColumnFilterMeta } from '../../types/column-filters'
import type { IpcResult } from '../../types/errors'

export interface CohortDomainContract {
  getVariants: (params: CohortSearchParams) => Promise<
    IpcResult<{
      data: CohortVariant[]
      total_count: number
      /** Optional same-load read warnings (Sprint A PR-3 C5). */
      warnings?: { staleSummary?: boolean }
      /** Keyset cursor for the directly following page (default sort). */
      next_cursor?: string
      paging?: 'keyset'
    }>
  >
  getColumnMeta: () => Promise<IpcResult<ColumnFilterMeta[]>>
  getSummary: () => Promise<IpcResult<CohortSummary>>
  getCarriers: (
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ) => Promise<IpcResult<CohortCarrier[]>>
  getGeneBurden: () => Promise<IpcResult<GeneBurden[]>>
  getSummaryStatus: () => Promise<IpcResult<{ is_stale: boolean; last_rebuilt_at: number }>>
  rebuildSummary: () => Promise<IpcResult<void>>
  runAssociation: (config: unknown) => Promise<IpcResult<unknown>>
  cancelAssociation: () => Promise<IpcResult<void>>
}
