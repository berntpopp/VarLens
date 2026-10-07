import { defineQueryOptions } from '@pinia/colada'

import { unwrapIpcResult } from '../../../shared/types/errors'
import { ALWAYS_STALE } from './client'
import { queryApi } from './gate'
import { queryKeys } from './keys'

/** The transcripts stored for one variant; `null` reads nothing. */
export const transcriptsQuery = defineQueryOptions((variantId: number | null) => ({
  key: queryKeys.transcripts(variantId ?? 0),
  query: async () => unwrapIpcResult(await queryApi().transcripts.list(variantId ?? 0)),
  enabled: variantId !== null,
  staleTime: ALWAYS_STALE
}))
