import { z } from 'zod'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import type { VariantFilter, PaginationCursor, SortItem } from '../../database/types'
import {
  VariantFilterPartialSchema,
  CaseIdSchema,
  LimitSchema,
  PaginationCursorSchema,
  SortItemSchema
} from '../../../shared/types/ipc-schemas'
import { mainLogger } from '../../services/MainLogger'

/**
 * Variants IPC handlers
 * Channels: variants:query, variants:filterOptions, variants:search, variants:geneSymbols
 */

// Schema for search query params
const SearchQuerySchema = z.string().min(1).max(100)

export function registerVariantHandlers({ ipcMain, getDb }: HandlerDependencies): void {
  ipcMain.handle(
    'variants:query',
    async (
      _event,
      caseId: unknown,
      filters: unknown,
      cursor: unknown,
      limit: unknown,
      sortBy: unknown
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
        let validatedCursor: PaginationCursor | undefined
        if (cursor !== undefined && cursor !== null) {
          const cursorResult = PaginationCursorSchema.safeParse(cursor)
          if (!cursorResult.success) {
            mainLogger.error(
              `Invalid variants:query cursor: ${cursorResult.error.message}`,
              'variants'
            )
            throw new Error('Invalid pagination cursor')
          }
          validatedCursor = cursorResult.data
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

        const db = getDb()
        const fullFilter: VariantFilter = {
          case_id: validatedCaseId.data,
          ...validatedFilters.data
        }
        return db.variants.getVariants(fullFilter, validatedLimit, validatedCursor, validatedSortBy)
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

        const db = getDb()
        return db.variants.getGeneSymbols(validatedCaseId.data, validatedQuery.data, validatedLimit)
      })
    }
  )
}
