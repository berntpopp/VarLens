import { defineQueryOptions, useQueryCache } from '@pinia/colada'

import type { CohortVariant, CohortVariantIdentity } from '../../../shared/types/cohort'
import { unwrapIpcResult } from '../../../shared/types/errors'
import { canQuery, queryApi } from './gate'
import { queryKeys } from './keys'

/** The cases that carry one cohort row (one variant type in one genome build). */
export const carriersQuery = defineQueryOptions(
  (variant: Pick<CohortVariant, 'variant_key' | keyof CohortVariantIdentity>) => ({
    key: queryKeys.carriers(variant.variant_key),
    query: async () =>
      unwrapIpcResult(
        // A plain object: the row is a reactive proxy, which IPC cannot clone.
        await queryApi().cohort.getCarriers({
          chr: variant.chr,
          pos: variant.pos,
          ref: variant.ref,
          alt: variant.alt,
          variant_type: variant.variant_type,
          genome_build: variant.genome_build
        })
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
