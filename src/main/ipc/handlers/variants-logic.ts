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
import type { StorageSession } from '../../storage/session'
import type { ColumnFilterMeta } from '../../../shared/types/column-filters'
import { computePanelIntervals } from './panelIntervalHelper'

type GetSession = () => StorageSession
type GetDb = () => DatabaseService
type GetDbPool = () => DbPool | null

function isStorageSession(value: unknown): value is StorageSession {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('getReadExecutor' in value || 'capabilities' in value)
  )
}

function resolveReadDependencies(
  getSessionOrDb: GetSession | GetDb,
  getDbOrPool?: GetDb | GetDbPool,
  getDbPool?: GetDbPool
):
  | { session: StorageSession; getDb?: GetDb; getDbPool?: GetDbPool }
  | { session?: undefined; db: DatabaseService; getDb: GetDb; getDbPool?: GetDbPool } {
  let value: StorageSession | DatabaseService
  try {
    value = getSessionOrDb()
  } catch (error) {
    if (getDbOrPool === undefined) throw error
    const getDb = getDbOrPool as GetDb
    return {
      db: getDb(),
      getDb,
      getDbPool
    }
  }
  if (isStorageSession(value)) {
    return {
      session: value,
      getDb: getDbOrPool as GetDb | undefined,
      getDbPool
    }
  }

  return {
    db: value,
    getDb: getSessionOrDb as GetDb,
    getDbPool: getDbOrPool as GetDbPool | undefined
  }
}

/**
 * Build a full variant filter, resolving panel intervals if needed.
 *
 * Separated so both pool and non-pool paths share the same filter preparation.
 */
export function buildVariantFilter(
  caseId: number,
  filters: Partial<VariantFilter>,
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null,
  getSession?: () => StorageSession
): VariantFilter {
  const fullFilter: VariantFilter = {
    case_id: caseId,
    ...filters
  }

  if (fullFilter.active_panel_ids && fullFilter.active_panel_ids.length > 0) {
    if (getSession !== undefined) {
      try {
        if (getSession().capabilities.backend === 'postgres') {
          return fullFilter
        }
      } catch {
        // Legacy tests and compatibility callers may not provide a session yet.
      }
    }

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

      // Throws if the computation itself fails — never treat that as "no
      // panel configured" (see panelIntervalHelper.ts for the contract).
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
      fullFilter.panel_intervals = intervals

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
  getSessionOrDb: GetSession | GetDb,
  getDbOrPool?: GetDb | GetDbPool,
  getDbPool?: GetDbPool
): Promise<unknown> {
  const deps = resolveReadDependencies(getSessionOrDb, getDbOrPool, getDbPool)
  if (deps.session !== undefined) {
    return await deps.session.getReadExecutor().execute({
      type: 'variants:query',
      params: [fullFilter, limit, offset, sortBy, skipCount, includeUnfilteredCount]
    })
  }

  const pool = deps.getDbPool?.()
  if (pool) {
    return await pool.run({
      type: 'variants:query',
      params: [fullFilter, limit, offset, sortBy, skipCount, includeUnfilteredCount]
    })
  }

  return deps.db.variants.getVariants(
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
  getSessionOrDb: GetSession | GetDb,
  getDbOrPool?: GetDb | GetDbPool,
  getDbPool?: GetDbPool
): Promise<unknown> {
  const deps = resolveReadDependencies(getSessionOrDb, getDbOrPool, getDbPool)
  if (deps.session !== undefined) {
    return await deps.session.getReadExecutor().execute({
      type: 'variants:filterOptions',
      params: [caseId]
    })
  }

  const pool = deps.getDbPool?.()
  if (pool) {
    return await pool.run({ type: 'variants:filterOptions', params: [caseId] })
  }

  return deps.db.variants.getFilterOptions(caseId)
}

/**
 * FTS5 full-text search for variants.
 */
function unwrapVariantSearchResult(result: unknown): unknown {
  if (
    result !== null &&
    typeof result === 'object' &&
    Array.isArray((result as { data?: unknown }).data)
  ) {
    return (result as { data: unknown[] }).data
  }
  return result
}

export async function searchVariants(
  caseId: number,
  query: string,
  limit: number,
  getSessionOrDb: GetSession | GetDb,
  getDbOrPool?: GetDb | GetDbPool,
  getDbPool?: GetDbPool
): Promise<unknown> {
  const deps = resolveReadDependencies(getSessionOrDb, getDbOrPool, getDbPool)
  if (deps.session !== undefined) {
    const result = await deps.session.getReadExecutor().execute({
      type: 'variants:search',
      params: [caseId, query, limit]
    })
    return unwrapVariantSearchResult(result)
  }

  const pool = deps.getDbPool?.()
  if (pool) {
    return await pool.run({
      type: 'variants:search',
      params: [caseId, query, limit]
    })
  }

  return deps.db.variants.searchVariants(caseId, query, limit)
}

/**
 * Get gene symbols for autocomplete (LIKE-based).
 */
export async function getGeneSymbols(
  caseId: number,
  query: string,
  limit: number,
  getSessionOrDb: GetSession | GetDb,
  getDbOrPool?: GetDb | GetDbPool,
  getDbPool?: GetDbPool
): Promise<unknown> {
  const deps = resolveReadDependencies(getSessionOrDb, getDbOrPool, getDbPool)
  if (deps.session !== undefined) {
    return await deps.session.getReadExecutor().execute({
      type: 'variants:geneSymbols',
      params: [caseId, query, limit]
    })
  }

  const pool = deps.getDbPool?.()
  if (pool) {
    return await pool.run({
      type: 'variants:geneSymbols',
      params: [caseId, query, limit]
    })
  }

  return deps.db.variants.getGeneSymbols(caseId, query, limit)
}

/**
 * Get variant type counts per case for tab badges (snv, indel, sv, cnv, str).
 */
export async function getVariantTypeCounts(
  caseId: number,
  getSessionOrDb: GetSession | GetDb,
  getDbOrPool?: GetDb | GetDbPool,
  getDbPool?: GetDbPool
): Promise<Record<string, number>> {
  const deps = resolveReadDependencies(getSessionOrDb, getDbOrPool, getDbPool)
  if (deps.session !== undefined) {
    return (await deps.session.getReadExecutor().execute({
      type: 'variants:typeCounts',
      params: [caseId]
    })) as Record<string, number>
  }

  const pool = deps.getDbPool?.()
  if (pool) {
    return (await pool.run({
      type: 'variants:typeCounts',
      params: [caseId]
    })) as Record<string, number>
  }

  return deps.db.variants.getVariantTypeCounts(caseId)
}

/**
 * Get per-column metadata for a single column (single-case or cohort scope).
 *
 * Used by the filter UI to lazy-load on-demand column metadata as users
 * interact with individual column filter menus. This complements the bulk
 * `getFilterOptions` path which preloads all columns for the initial render.
 *
 * Internally dispatches between the base-column and extension-column paths
 * via `VariantRepository.getColumnMeta` based on whether `columnKey` is
 * dotted (e.g. `cnv.copy_number` → extension, `gnomad_af` → base).
 */
export async function getColumnMetaForKey(
  scope: { caseId: number } | { caseIds: number[] },
  columnKey: string,
  getSessionOrDb: GetSession | GetDb,
  getDbOrPool?: GetDb | GetDbPool,
  getDbPool?: GetDbPool
): Promise<ColumnFilterMeta> {
  const deps = resolveReadDependencies(getSessionOrDb, getDbOrPool, getDbPool)
  if (deps.session !== undefined) {
    return (await deps.session.getReadExecutor().execute({
      type: 'variants:columnMeta',
      params: [scope, columnKey]
    })) as ColumnFilterMeta
  }

  const pool = deps.getDbPool?.()
  if (pool) {
    return (await pool.run({
      type: 'variants:columnMeta',
      params: [scope, columnKey]
    })) as ColumnFilterMeta
  }

  return deps.db.variants.getColumnMeta(scope, columnKey)
}

/**
 * Get the distinct variant types present in a single case or cohort.
 *
 * Used by the renderer to auto-hide variant-type tabs/filter chips that
 * contain no data (e.g. a SNV-only case hides the SV/CNV/STR tabs).
 *
 * Returns an array (not a Set) because IPC serialization cannot transmit
 * Set instances — they would arrive on the renderer side as empty objects.
 */
export async function getVariantTypesPresent(
  scope: { caseId: number } | { caseIds: number[] },
  getSessionOrDb: GetSession | GetDb,
  getDbOrPool?: GetDb | GetDbPool,
  getDbPool?: GetDbPool
): Promise<string[]> {
  const deps = resolveReadDependencies(getSessionOrDb, getDbOrPool, getDbPool)
  if (deps.session !== undefined) {
    return (await deps.session.getReadExecutor().execute({
      type: 'variants:typesPresent',
      params: [scope]
    })) as string[]
  }

  const pool = deps.getDbPool?.()
  if (pool) {
    // Worker already serializes Set → string[] (structured-clone drops Set
    // contents across thread boundaries); just forward the array.
    return (await pool.run({
      type: 'variants:typesPresent',
      params: [scope]
    })) as string[]
  }

  return Array.from(deps.db.variants.getVariantTypesPresent(scope))
}
