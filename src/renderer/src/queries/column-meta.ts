import { defineQueryOptions } from '@pinia/colada'

import { unwrapIpcResult } from '../../../shared/types/errors'
import { canQuery, queryApi } from './gate'
import { isEmptyScope, queryKeys, type QueryScope } from './keys'

/** Variant types that have data in the scope; hides empty type sections. */
export const typesPresentQuery = defineQueryOptions((scope: QueryScope) => ({
  key: queryKeys.typesPresent(scope),
  query: async () =>
    new Set(
      unwrapIpcResult(
        await queryApi().variants.typesPresent({ caseId: scope.caseId, caseIds: scope.caseIds })
      )
    ),
  enabled: !isEmptyScope(scope) && canQuery('variants.typesPresent')
}))

/** Bounds and distinct values of one extension column in the scope. */
export const columnMetaQuery = defineQueryOptions(
  ({ scope, columnKey }: { scope: QueryScope; columnKey: string }) => ({
    key: queryKeys.columnMeta(scope, columnKey),
    query: async () =>
      unwrapIpcResult(
        await queryApi().variants.columnMeta({
          caseId: scope.caseId,
          caseIds: scope.caseIds,
          columnKey
        })
      ),
    enabled: !isEmptyScope(scope) && canQuery('variants.columnMeta')
  })
)
