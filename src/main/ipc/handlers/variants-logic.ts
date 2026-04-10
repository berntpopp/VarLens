/**
 * Pure business logic for variants IPC handlers.
 *
 * All functions take explicit dependencies (db, pool, etc.) as parameters
 * and never touch IPC/Electron APIs directly. This makes them testable
 * without mocking Electron internals.
 */
import type { VariantFilter, SortItem } from '../../database/types'
import type { DatabaseService } from '../../database/DatabaseService'
import type { DbPool } from '../../database/DbPool'
import { computePanelIntervals } from './panelIntervalHelper'

/**
 * Build a full variant filter, resolving panel intervals if needed.
 *
 * Separated so both pool and non-pool paths share the same filter preparation.
 */
export function buildVariantFilter(
  caseId: number,
  filters: Partial<VariantFilter>,
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): VariantFilter {
  const fullFilter: VariantFilter = {
    case_id: caseId,
    ...filters
  }

  if (fullFilter.active_panel_ids && fullFilter.active_panel_ids.length > 0) {
    const pool = getDbPool?.()
    if (pool) {
      // Pool path: let the worker resolve intervals off the main thread.
      // Attach genome_build so the worker can look up coordinates in the
      // correct assembly without making an extra IPC-side DB call.
      const dbRef = getDb()
      const caseData = dbRef.cases.getCase(fullFilter.case_id)
      ;(fullFilter as VariantFilter & { genome_build?: string }).genome_build =
        caseData?.genome_build ?? 'GRCh38'
      // active_panel_ids and panel_padding_bp are forwarded as-is
    } else {
      // Fallback (no pool): compute on the main thread synchronously
      const dbRef = getDb()
      const caseData = dbRef.cases.getCase(fullFilter.case_id)
      const genomeBuild = caseData?.genome_build ?? 'GRCh38'

      const intervals = computePanelIntervals(
        dbRef,
        {
          active_panel_ids: fullFilter.active_panel_ids,
          panel_padding_bp: fullFilter.panel_padding_bp,
          genome_build: genomeBuild
        },
        fullFilter.case_id,
        'variants'
      )
      if (intervals) {
        fullFilter.panel_intervals = intervals
      }

      // Clean up IPC-only fields that shouldn't reach the repository
      delete fullFilter.active_panel_ids
      delete fullFilter.panel_padding_bp
    }
  }

  return fullFilter
}

/**
 * Query variants with filtering, pagination, and sorting.
 * Resolves panel intervals and delegates to pool or direct DB.
 */
export async function queryVariants(
  fullFilter: VariantFilter,
  limit: number,
  offset: number,
  sortBy: SortItem[] | undefined,
  skipCount: boolean,
  includeUnfilteredCount: boolean,
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<unknown> {
  const pool = getDbPool?.()
  if (pool) {
    return await pool.run({
      type: 'variants:query',
      params: [fullFilter, limit, offset, sortBy, skipCount, includeUnfilteredCount]
    })
  }

  const db = getDb()
  return db.variants.getVariants(
    fullFilter,
    limit,
    offset,
    sortBy,
    skipCount,
    includeUnfilteredCount
  )
}

/**
 * Get filter options for a specific case.
 */
export async function getFilterOptions(
  caseId: number,
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<unknown> {
  const pool = getDbPool?.()
  if (pool) {
    return await pool.run({ type: 'variants:filterOptions', params: [caseId] })
  }

  const db = getDb()
  return db.variants.getFilterOptions(caseId)
}

/**
 * FTS5 full-text search for variants.
 */
export async function searchVariants(
  caseId: number,
  query: string,
  limit: number,
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<unknown> {
  const pool = getDbPool?.()
  if (pool) {
    return await pool.run({
      type: 'variants:search',
      params: [caseId, query, limit]
    })
  }

  const db = getDb()
  return db.variants.searchVariants(caseId, query, limit)
}

/**
 * Get gene symbols for autocomplete (LIKE-based).
 */
export async function getGeneSymbols(
  caseId: number,
  query: string,
  limit: number,
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<unknown> {
  const pool = getDbPool?.()
  if (pool) {
    return await pool.run({
      type: 'variants:geneSymbols',
      params: [caseId, query, limit]
    })
  }

  const db = getDb()
  return db.variants.getGeneSymbols(caseId, query, limit)
}

/**
 * Get variant type counts per case for tab badges (snv, indel, sv, cnv, str).
 */
export async function getVariantTypeCounts(
  caseId: number,
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<Record<string, number>> {
  const pool = getDbPool?.()
  if (pool) {
    return (await pool.run({
      type: 'variants:typeCounts',
      params: [caseId]
    })) as Record<string, number>
  }

  const db = getDb()
  return db.variants.getVariantTypeCounts(caseId)
}
