import { defineQueryOptions, useQueryCache } from '@pinia/colada'

import type { CohortVariant } from '../../../shared/types/cohort'
import { unwrapIpcResult } from '../../../shared/types/errors'
import { canQuery, queryApi } from './gate'
import { queryKeys } from './keys'

/** The cases that carry one cohort variant. */
export const carriersQuery = defineQueryOptions(
  (variant: Pick<CohortVariant, 'variant_key' | 'chr' | 'pos' | 'ref' | 'alt'>) => ({
    key: queryKeys.carriers(variant.variant_key),
    query: async () =>
      unwrapIpcResult(
        await queryApi().cohort.getCarriers(variant.chr, variant.pos, variant.ref, variant.alt)
      ),
    enabled: canQuery('cohort.carriers')
  })
)

/**
 * Refetch the carriers of the expanded rows; the rest reload when next shown.
 * For a cohort refresh that `invalidateServerData` does not announce (the
 * summary was rebuilt, the table was reloaded).
 */
export function invalidateCarriers(): void {
  void useQueryCache()
    .invalidateQueries({ key: queryKeys.carriersRoot() })
    .catch(() => undefined)
}
