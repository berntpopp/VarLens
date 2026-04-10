import { z } from 'zod'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import type { SortItem } from '../../database/types'
import {
  VariantFilterPartialSchema,
  CaseIdSchema,
  LimitSchema,
  OffsetSchema,
  SortItemSchema
} from '../../../shared/types/ipc-schemas'
import { mainLogger } from '../../services/MainLogger'
import { clearPanelIntervalCache } from './panelIntervalHelper'
import {
  buildVariantFilter,
  queryVariants,
  getFilterOptions,
  searchVariants,
  getGeneSymbols,
  getVariantTypeCounts
} from './variants-logic'

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

        const validatedSkipCount = skipCount === true
        const validatedIncludeUnfilteredCount = includeUnfilteredCount === true

        const fullFilter = buildVariantFilter(
          validatedCaseId.data,
          validatedFilters.data,
          getDb,
          getDbPool
        )

        return queryVariants(
          fullFilter,
          validatedLimit,
          validatedOffset,
          validatedSortBy,
          validatedSkipCount,
          validatedIncludeUnfilteredCount,
          getDb,
          getDbPool
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

      return getFilterOptions(validatedCaseId.data, getDb, getDbPool)
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

        return searchVariants(
          validatedCaseId.data,
          validatedQuery.data,
          validatedLimit,
          getDb,
          getDbPool
        )
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

        return getGeneSymbols(
          validatedCaseId.data,
          validatedQuery.data,
          validatedLimit,
          getDb,
          getDbPool
        )
      })
    }
  )

  /**
   * Get variant type counts per case (for tab badges).
   * Channel: variants:typeCounts
   * Returns: Record<string, number> e.g. { snv: 1234, indel: 56, sv: 12 }
   */
  ipcMain.handle('variants:typeCounts', async (_event, caseId: unknown) => {
    return wrapHandler(async () => {
      const validatedCaseId = CaseIdSchema.safeParse(caseId)
      if (!validatedCaseId.success) {
        mainLogger.error(
          `Invalid variants:typeCounts caseId: ${validatedCaseId.error.message}`,
          'variants'
        )
        throw new Error('Invalid case ID')
      }

      return getVariantTypeCounts(validatedCaseId.data, getDb, getDbPool)
    })
  })
}
