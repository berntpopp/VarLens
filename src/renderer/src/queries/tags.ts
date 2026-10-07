import { defineQueryOptions, useQueryCache } from '@pinia/colada'

import type { Tag } from '../../../shared/types/database-entities'
import { unwrapIpcResult } from '../../../shared/types/errors'
import { canQuery, queryApi } from './gate'
import { queryKeys } from './keys'

/**
 * Tags are edited by people, in the web workspace by several at once, and no
 * event announces another client's edit. So unlike the rest of the cache they
 * are refetched whenever a view showing them mounts or moves to another
 * variant, as they were before the query cache.
 */
const ALWAYS_STALE = 0

/** Every tag of the open database. */
export const tagListQuery = defineQueryOptions(() => ({
  key: queryKeys.tags(),
  query: async () => unwrapIpcResult(await queryApi().tags.list()),
  enabled: canQuery('workflow.tags'),
  staleTime: ALWAYS_STALE
}))

/** Tags assigned to one variant of one case. */
export const variantTagsQuery = defineQueryOptions(
  ({ caseId, variantId }: { caseId: number; variantId: number }) => ({
    key: queryKeys.variantTags(caseId, variantId),
    query: async () => unwrapIpcResult(await queryApi().tags.getVariantTags(caseId, variantId)),
    enabled: canQuery('workflow.tags'),
    staleTime: ALWAYS_STALE
  })
)

/**
 * Refetch the tag list and, if tags were renamed or removed, where they are
 * assigned. Called after a write that has already succeeded, so a refetch that
 * fails (it is logged by the cache) must not fail the write.
 */
export async function invalidateTags(includeAssignments: boolean): Promise<void> {
  const cache = useQueryCache()
  await Promise.all([
    cache.invalidateQueries({ key: queryKeys.tags() }),
    includeAssignments &&
      cache.invalidateQueries({
        key: queryKeys.root(),
        predicate: (entry) => queryKeys.isVariantTags(entry.key)
      })
  ]).catch(() => undefined)
}

/**
 * Show a variant's new tags at once and run the write behind them. On failure
 * the previous tags come back, unless something else has written since. Either
 * way the server's answer is then fetched, which also covers a write made
 * before the first read had finished. The key is fixed when the write starts,
 * so a write that settles after another database was opened can only reach
 * the old database's entry.
 */
export async function writeVariantTags(
  target: { caseId: number; variantId: number },
  next: Tag[],
  run: () => Promise<unknown>
): Promise<void> {
  const cache = useQueryCache()
  const key = queryKeys.variantTags(target.caseId, target.variantId)
  const previous = cache.getQueryData<Tag[]>(key) ?? []

  // A read still in flight would overwrite the optimistic value when it lands.
  cache.cancelQueries({ key, exact: true })
  cache.setQueryData(key, next)
  try {
    await run()
  } catch (error) {
    if (cache.getQueryData(key) === next) cache.setQueryData(key, previous)
    throw error
  } finally {
    void cache.invalidateQueries({ key, exact: true }).catch(() => undefined)
  }
}
