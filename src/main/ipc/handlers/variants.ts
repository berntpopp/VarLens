import { z } from 'zod'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import type { SortItem } from '../../database/types'
import {
  VariantFilterPartialSchema,
  CaseIdSchema,
  LimitSchema,
  OffsetSchema,
  SortItemSchema,
  ColumnMetaPayloadSchema,
  TypesPresentPayloadSchema
} from '../../../shared/types/ipc-schemas'
import { VariantSearchQuerySchema as SearchQuerySchema } from '../../../shared/api/schemas/variants'
import { mainLogger } from '../../services/MainLogger'
import { clearPanelIntervalCache } from './panelIntervalHelper'
import {
  buildVariantFilter,
  queryVariants,
  getFilterOptions,
  searchVariants,
  getGeneSymbols,
  getVariantTypeCounts,
  getColumnMetaForKey,
  getVariantTypesPresent
} from './variants-logic'

// Re-export for consumers that import from this module
export { clearPanelIntervalCache }

/**
 * Variants IPC handlers
 * Channels: variants:query, variants:filterOptions, variants:search, variants:geneSymbols
 */

export function registerVariantHandlers({
  ipcMain,
  getDb,
  getDbManager,
  getDbPool
}: HandlerDependencies): void {
  const getSession = () => getDbManager().getCurrentSession()

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
          getDbPool,
          getSession
        )

        return queryVariants(
          fullFilter,
          validatedLimit,
          validatedOffset,
          validatedSortBy,
          validatedSkipCount,
          validatedIncludeUnfilteredCount,
          getSession,
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

      return getFilterOptions(validatedCaseId.data, getSession, getDb, getDbPool)
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
          getSession,
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
          getSession,
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

      return getVariantTypeCounts(validatedCaseId.data, getSession, getDb, getDbPool)
    })
  })

  /**
   * Get per-column metadata for a single column (single-case or cohort scope).
   * Channel: variants:columnMeta
   *
   * Payload: { caseId?: number, caseIds?: number[], columnKey: string }
   * Either caseId or a non-empty caseIds array must be provided.
   *
   * Returns: ColumnFilterMeta — single-column metadata used by the filter UI
   * to auto-detect numeric/text data types, min/max, and low-cardinality
   * distinct values for column filter auto-suggest. Dispatches base vs
   * extension column paths via VariantRepository.getColumnMeta.
   */
  ipcMain.handle('variants:columnMeta', async (_event, payload: unknown) => {
    return wrapHandler(async () => {
      const validated = ColumnMetaPayloadSchema.safeParse(payload)
      if (!validated.success) {
        mainLogger.error(
          `Invalid variants:columnMeta payload: ${validated.error.message}`,
          'variants'
        )
        throw new Error('Invalid columnMeta payload')
      }
      const { caseId, caseIds, columnKey } = validated.data
      const scope: { caseId: number } | { caseIds: number[] } =
        caseIds !== undefined ? { caseIds } : { caseId: caseId as number }
      return getColumnMetaForKey(scope, columnKey, getSession, getDb, getDbPool)
    })
  })

  /**
   * Get distinct variant types present for a single case or cohort.
   * Channel: variants:typesPresent
   *
   * Payload: { caseId?: number, caseIds?: number[] }
   * Either caseId or a non-empty caseIds array must be provided.
   *
   * Returns: string[] — distinct variant_type values present in the scope,
   * used by the renderer auto-hide logic to dim SV/CNV/STR tabs that have
   * no data for the current case(s).
   */
  ipcMain.handle('variants:typesPresent', async (_event, payload: unknown) => {
    return wrapHandler(async () => {
      const validated = TypesPresentPayloadSchema.safeParse(payload)
      if (!validated.success) {
        mainLogger.error(
          `Invalid variants:typesPresent payload: ${validated.error.message}`,
          'variants'
        )
        throw new Error('Invalid typesPresent payload')
      }
      const { caseId, caseIds } = validated.data
      const scope: { caseId: number } | { caseIds: number[] } =
        caseIds !== undefined ? { caseIds } : { caseId: caseId as number }
      return getVariantTypesPresent(scope, getSession, getDb, getDbPool)
    })
  })
}
