import type { SortItem, VariantFilter } from '../../../shared/types/database'
import { getFilterOptions, searchVariants } from '../../../main/ipc/handlers/variants-logic'
import {
  CaseIdSchema,
  LimitSchema,
  OffsetSchema,
  VariantColumnMetaPayloadSchema,
  VariantFilterPartialSchema,
  VariantSearchArgsSchema,
  VariantSortBySchema
} from '../../../shared/api/schemas/variants'
import type { OverrideHandler } from './types'

export function buildVariantOverrides(): Record<string, OverrideHandler> {
  return {
    'variants:search': {
      async handle(args, _request, reply, { session }) {
        const parsed = VariantSearchArgsSchema.safeParse(args)
        if (!parsed.success) {
          reply.code(400)
          return { error: 'invalid-variant-search' }
        }
        const [caseId, query, limit] = parsed.data
        return await searchVariants(caseId, query, limit ?? 20, () => session)
      }
    },

    'variants:columnMeta': {
      async handle(args, _request, reply, { session }) {
        const [payload] = args
        const validated = VariantColumnMetaPayloadSchema.safeParse(payload)
        if (!validated.success) {
          reply.code(400)
          return { error: 'invalid-column-meta-payload' }
        }
        const value = validated.data
        const scope =
          typeof value.caseId === 'number'
            ? { caseId: value.caseId }
            : { caseIds: value.caseIds as number[] }
        return await session.getReadExecutor().execute({
          type: 'variants:columnMeta',
          params: [scope, value.columnKey]
        })
      }
    },

    'variants:query': {
      async handle(args, _request, reply, { session }) {
        const [caseId, filters, offset, limit, sortBy, skipCount, includeUnfilteredCount, cursor] =
          args

        const validatedCaseId = CaseIdSchema.safeParse(caseId)
        if (!validatedCaseId.success) {
          reply.code(400)
          return { error: 'invalid-case-id', message: 'Invalid case ID' }
        }

        const validatedFilters = VariantFilterPartialSchema.safeParse(filters)
        if (!validatedFilters.success) {
          reply.code(400)
          return { error: 'invalid-filters', message: 'Invalid filter parameters' }
        }

        const offsetResult =
          offset === undefined || offset === null ? { data: 0 } : OffsetSchema.safeParse(offset)
        if ('success' in offsetResult && !offsetResult.success) {
          reply.code(400)
          return { error: 'invalid-offset', message: 'Invalid offset parameter' }
        }

        const limitResult =
          limit === undefined || limit === null ? { data: 50 } : LimitSchema.safeParse(limit)
        if ('success' in limitResult && !limitResult.success) {
          reply.code(400)
          return { error: 'invalid-limit', message: 'Invalid limit parameter' }
        }

        let validatedSortBy: SortItem[] | undefined
        if (sortBy !== undefined && sortBy !== null) {
          const sortByResult = VariantSortBySchema.safeParse(sortBy)
          if (!sortByResult.success) {
            reply.code(400)
            return { error: 'invalid-sort', message: 'Invalid sort parameters' }
          }
          validatedSortBy = sortByResult.data
        }

        if (
          cursor !== undefined &&
          cursor !== null &&
          (typeof cursor !== 'string' || cursor.length > 1024)
        ) {
          reply.code(400)
          return { error: 'invalid-cursor', message: 'Invalid page cursor' }
        }

        const fullFilter: VariantFilter = {
          case_id: validatedCaseId.data,
          ...validatedFilters.data
        }

        return await session.getReadExecutor().execute({
          type: 'variants:query',
          params: [
            fullFilter,
            limitResult.data,
            offsetResult.data,
            validatedSortBy,
            skipCount === true,
            includeUnfilteredCount === true,
            // Opt-in: '' asks for a first page plus next_cursor; a cursor
            // string resumes after the previous page (variant-paging.ts).
            typeof cursor === 'string' ? (cursor === '' ? {} : { cursor }) : undefined
          ]
        })
      }
    },

    'variants:getFilterOptions': {
      async handle(args, _request, reply, { session }) {
        const [caseId] = args
        const validatedCaseId = CaseIdSchema.safeParse(caseId)
        if (!validatedCaseId.success) {
          reply.code(400)
          return { error: 'invalid-case-id', message: 'Invalid case ID' }
        }

        return await getFilterOptions(validatedCaseId.data, () => session)
      }
    }
  }
}
