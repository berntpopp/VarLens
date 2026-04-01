import { z } from 'zod'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import type { VariantFilter, SortItem } from '../../database/types'
import {
  VariantFilterPartialSchema,
  CaseIdSchema,
  LimitSchema,
  OffsetSchema,
  SortItemSchema
} from '../../../shared/types/ipc-schemas'
import { mainLogger } from '../../services/MainLogger'
import { computePanelIntervals, clearPanelIntervalCache } from './panelIntervalHelper'

// Re-export for consumers that import from this module
export { clearPanelIntervalCache }

/**
 * Variants IPC handlers
 * Channels: variants:query, variants:filterOptions, variants:search, variants:geneSymbols
 */

// Schema for search query params
const SearchQuerySchema = z.string().min(1).max(100)

export function registerVariantHandlers({ ipcMain, getDb, getDbPool }: HandlerDependencies): void {
  ipcMain.handle(
    'variants:query',
    async (
      _event,
      caseId: unknown,
      filters: unknown,
      offset: unknown,
      limit: unknown,
      sortBy: unknown,
      skipCount: unknown,
      includeUnfilteredCount: unknown
    ) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validatedCaseId = CaseIdSchema.safeParse(caseId)
        if (!validatedCaseId.success) {
          mainLogger.error(
            `Invalid variants:query caseId: ${validatedCaseId.error.message}`,
            'variants'
          )
          throw new Error('Invalid case ID')
        }

        const validatedFilters = VariantFilterPartialSchema.safeParse(filters)
        if (!validatedFilters.success) {
          mainLogger.error(
            `Invalid variants:query filters: ${validatedFilters.error.message}`,
            'variants'
          )
          throw new Error('Invalid filter parameters')
        }

        // Validate optional parameters
        let validatedOffset = 0
        if (offset !== undefined && offset !== null) {
          const offsetResult = OffsetSchema.safeParse(offset)
          if (!offsetResult.success) {
            mainLogger.error(
              `Invalid variants:query offset: ${offsetResult.error.message}`,
              'variants'
            )
            throw new Error('Invalid offset parameter')
          }
          validatedOffset = offsetResult.data
        }

        let validatedLimit = 50
        if (limit !== undefined && limit !== null) {
          const limitResult = LimitSchema.safeParse(limit)
          if (!limitResult.success) {
            mainLogger.error(
              `Invalid variants:query limit: ${limitResult.error.message}`,
              'variants'
            )
            throw new Error('Invalid limit parameter')
          }
          validatedLimit = limitResult.data
        }

        let validatedSortBy: SortItem[] | undefined
        if (sortBy !== undefined && sortBy !== null) {
          const sortByResult = z.array(SortItemSchema).safeParse(sortBy)
          if (!sortByResult.success) {
            mainLogger.error(
              `Invalid variants:query sortBy: ${sortByResult.error.message}`,
              'variants'
            )
            throw new Error('Invalid sort parameters')
          }
          validatedSortBy = sortByResult.data
        }

        const fullFilter: VariantFilter = {
          case_id: validatedCaseId.data,
          ...validatedFilters.data
        }

        const pool = getDbPool?.()

        if (fullFilter.active_panel_ids && fullFilter.active_panel_ids.length > 0) {
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

        const validatedSkipCount = skipCount === true
        const validatedIncludeUnfilteredCount = includeUnfilteredCount === true

        if (pool) {
          return await pool.run({
            type: 'variants:query',
            params: [
              fullFilter,
              validatedLimit,
              validatedOffset,
              validatedSortBy,
              validatedSkipCount,
              validatedIncludeUnfilteredCount
            ]
          })
        }

        const db = getDb()
        return db.variants.getVariants(
          fullFilter,
          validatedLimit,
          validatedOffset,
          validatedSortBy,
          validatedSkipCount,
          validatedIncludeUnfilteredCount
        )
      })
    }
  )

  ipcMain.handle('variants:filterOptions', async (_event, caseId: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validatedCaseId = CaseIdSchema.safeParse(caseId)
      if (!validatedCaseId.success) {
        mainLogger.error(
          `Invalid variants:filterOptions caseId: ${validatedCaseId.error.message}`,
          'variants'
        )
        throw new Error('Invalid case ID')
      }

      const pool = getDbPool?.()
      if (pool) {
        return await pool.run({ type: 'variants:filterOptions', params: [validatedCaseId.data] })
      }

      const db = getDb()
      return db.variants.getFilterOptions(validatedCaseId.data)
    })
  })

  /**
   * FTS5 full-text search for gene symbol autocomplete (FLT-06).
   * Uses DatabaseService.searchVariants() which performs prefix matching via FTS5.
   */
  ipcMain.handle(
    'variants:search',
    async (_event, caseId: unknown, query: unknown, limit: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validatedCaseId = CaseIdSchema.safeParse(caseId)
        if (!validatedCaseId.success) {
          mainLogger.error(
            `Invalid variants:search caseId: ${validatedCaseId.error.message}`,
            'variants'
          )
          throw new Error('Invalid case ID')
        }

        const validatedQuery = SearchQuerySchema.safeParse(query)
        if (!validatedQuery.success) {
          mainLogger.error(
            `Invalid variants:search query: ${validatedQuery.error.message}`,
            'variants'
          )
          throw new Error('Invalid search query')
        }

        let validatedLimit = 20
        if (limit !== undefined && limit !== null) {
          const limitResult = LimitSchema.safeParse(limit)
          if (!limitResult.success) {
            mainLogger.error(
              `Invalid variants:search limit: ${limitResult.error.message}`,
              'variants'
            )
            throw new Error('Invalid limit parameter')
          }
          validatedLimit = limitResult.data
        }

        const pool = getDbPool?.()
        if (pool) {
          return await pool.run({
            type: 'variants:search',
            params: [validatedCaseId.data, validatedQuery.data, validatedLimit]
          })
        }

        const db = getDb()
        return db.variants.searchVariants(validatedCaseId.data, validatedQuery.data, validatedLimit)
      })
    }
  )

  /**
   * Get gene symbols for autocomplete (optimized - uses LIKE instead of FTS5)
   * Channel: variants:geneSymbols
   */
  ipcMain.handle(
    'variants:geneSymbols',
    async (_event, caseId: unknown, query: unknown, limit: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validatedCaseId = CaseIdSchema.safeParse(caseId)
        if (!validatedCaseId.success) {
          mainLogger.error(
            `Invalid variants:geneSymbols caseId: ${validatedCaseId.error.message}`,
            'variants'
          )
          throw new Error('Invalid case ID')
        }

        const validatedQuery = SearchQuerySchema.safeParse(query)
        if (!validatedQuery.success) {
          mainLogger.error(
            `Invalid variants:geneSymbols query: ${validatedQuery.error.message}`,
            'variants'
          )
          throw new Error('Invalid search query')
        }

        let validatedLimit = 50
        if (limit !== undefined && limit !== null) {
          const limitResult = LimitSchema.safeParse(limit)
          if (limitResult.success) {
            validatedLimit = limitResult.data
          }
        }

        const pool = getDbPool?.()
        if (pool) {
          return await pool.run({
            type: 'variants:geneSymbols',
            params: [validatedCaseId.data, validatedQuery.data, validatedLimit]
          })
        }

        const db = getDb()
        return db.variants.getGeneSymbols(validatedCaseId.data, validatedQuery.data, validatedLimit)
      })
    }
  )
}
