import type { Variant, VariantFilter, PaginatedResult, SortItem } from '../../types/database'
import type { IpcResult } from '../../types/errors'
import type { FilterOptions } from '../../types/api'
import type { ColumnFilterMeta } from '../../types/column-filters'
import type { VariantPageResult } from '../../types/variant-paging'

export interface VariantsDomainContract {
  query: (
    caseId: number,
    filters: Omit<VariantFilter, 'case_id'>,
    offset?: number,
    limit?: number,
    sortBy?: SortItem[],
    skipCount?: boolean,
    includeUnfilteredCount?: boolean,
    /** Keyset opt-in: previous page's next_cursor, or '' (web/Postgres only; variant-paging.ts). */
    cursor?: string
  ) => Promise<
    IpcResult<PaginatedResult<Variant> & { unfiltered_count?: number } & VariantPageResult>
  >
  getFilterOptions: (caseId: number) => Promise<IpcResult<FilterOptions>>
  search: (caseId: number, query: string, limit?: number) => Promise<IpcResult<Variant[]>>
  geneSymbols: (caseId: number, query: string, limit?: number) => Promise<IpcResult<string[]>>
  typeCounts: (caseId: number) => Promise<IpcResult<Record<string, number>>>
  columnMeta: (payload: {
    caseId?: number
    caseIds?: number[]
    columnKey: string
  }) => Promise<IpcResult<ColumnFilterMeta>>
  typesPresent: (payload: { caseId?: number; caseIds?: number[] }) => Promise<IpcResult<string[]>>
}
