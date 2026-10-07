/**
 * The one way to tell the query cache that server data changed.
 *
 * - `data-changed`: an import finished or cases were deleted. Everything under
 *   the open database is invalidated; mounted queries refetch now, the rest
 *   when next used.
 * - `database-switch`: another database was opened. Keys are rooted at the
 *   database revision, so mounted queries have already moved to the new root;
 *   this cancels what was in flight for other databases and drops their
 *   entries. Entries a component still reads are left for the cache to
 *   collect once released. Safe to call more than once per switch.
 */
import { useQueryCache } from '@pinia/colada'

import { queryKeys } from './keys'

export type ServerDataEvent = 'data-changed' | 'database-switch'

export async function invalidateServerData(event: ServerDataEvent): Promise<void> {
  const cache = useQueryCache()
  const [, revision] = queryKeys.root()

  if (event === 'data-changed') {
    // A refetch that fails is logged and shown by its query; the event itself
    // never fails, so callers need not handle it.
    await cache.invalidateQueries({ key: queryKeys.root() }).catch(() => undefined)
    return
  }

  for (const entry of cache.getEntries({ predicate: (entry) => entry.key[1] !== revision })) {
    cache.cancel(entry)
    if (!entry.active) cache.remove(entry)
  }
}
