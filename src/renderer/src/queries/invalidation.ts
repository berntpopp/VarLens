/**
 * The one way to tell the query cache that server data changed.
 *
 * - `data-changed`: an import finished or cases were deleted. Everything under
 *   the open database is invalidated; mounted queries refetch now (the cohort
 *   scope first), the rest when next used.
 * - `database-switch`: another database was opened. Keys are rooted at the
 *   database revision, so mounted queries have already moved to the new root;
 *   this cancels what was in flight for other databases and drops their
 *   entries. Entries a component still reads are left for the cache to
 *   collect once released. Safe to call more than once per switch.
 */
import { nextTick, toValue } from 'vue'
import { useQueryCache, type QueryCache } from '@pinia/colada'

import { queryKeys } from './keys'

export type ServerDataEvent = 'data-changed' | 'database-switch'

export async function invalidateServerData(event: ServerDataEvent): Promise<void> {
  const cache = useQueryCache()
  const [, revision] = queryKeys.root()

  if (event === 'data-changed') {
    await refetchScopeFirst(cache)
    return
  }

  for (const entry of cache.getEntries({ predicate: (entry) => entry.key[1] !== revision })) {
    cache.cancel(entry)
    if (!entry.active) cache.remove(entry)
  }
}

/**
 * Mark everything stale, refetch the cohort scope (the case-id list), let its
 * consumers move to the new scope, then refetch what is still mounted and
 * stale. Refetching all at once would load cohort data for the old set of
 * cases and then again for the new one.
 *
 * A refetch that fails is logged and shown by its query; the event itself
 * never fails, so callers need not handle it.
 */
async function refetchScopeFirst(cache: QueryCache): Promise<void> {
  const refetch = (filter: Parameters<QueryCache['getEntries']>[0]): Promise<unknown> =>
    Promise.all(
      cache
        .getEntries({ ...filter, active: true, stale: true })
        .filter((entry) => toValue(entry.options?.enabled) === true)
        .map((entry) => cache.refresh(entry).catch(() => undefined))
    )

  await cache.invalidateQueries({ key: queryKeys.root() }, false)
  await refetch({ key: queryKeys.caseIds(), exact: true })
  await nextTick()
  await refetch({ key: queryKeys.root() })
}
