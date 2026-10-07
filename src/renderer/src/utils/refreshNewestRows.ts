import { mergeFirstPage } from './mergeFirstPage'

interface Page<T> {
  data: T[]
  /** Only the first page (offset 0) has to carry it. */
  total_count: number
}

/** Bounds one refresh; at 50 rows a page this is far beyond one refresh interval. */
const MAX_PAGES = 100

/**
 * Bring an already loaded, newest-first list up to date in place while rows
 * are being added on the server (cases finishing during a batch import).
 *
 * Fetching only the first page is not enough: when more than one page of
 * rows was added since the previous refresh, the rows between the first page
 * and the previously loaded ones would be missing until the next full
 * reload. So this pages from the top until either every added row was seen
 * (the total grew by that many) or the whole loaded window was re-read. The
 * second condition also covers rows that became visible below newer ones:
 * parallel imports publish in a different order than they were created.
 *
 * The result is a gap-free prefix of the server list, so its length is the
 * offset of the next infinite-scroll page.
 */
export async function refreshNewestRows<T extends { id: number }>(args: {
  existing: T[]
  /** Total the list reported at its previous load or refresh. */
  previousTotal: number
  pageSize: number
  fetchPage: (offset: number) => Promise<Page<T>>
}): Promise<{ rows: T[]; total: number }> {
  const { existing, previousTotal, pageSize, fetchPage } = args
  const known = new Set(existing.map((row) => row.id))
  const first = await fetchPage(0)
  const total = first.total_count
  const added = Math.max(0, total - previousTotal)

  const fetched: T[] = []
  const fetchedIds = new Set<number>()
  let unseen = 0
  const take = (rows: T[]): void => {
    for (const row of rows) {
      // A row can shift onto the next page while we are paging.
      if (fetchedIds.has(row.id)) continue
      fetchedIds.add(row.id)
      fetched.push(row)
      if (!known.has(row.id)) unseen++
    }
  }
  take(first.data)

  let offset = first.data.length
  let lastPageLength = first.data.length
  for (let page = 1; page < MAX_PAGES; page++) {
    const exhausted = lastPageLength < pageSize
    const sawEveryAddedRow = unseen >= added
    const coveredLoadedWindow = fetched.length >= existing.length + unseen
    if (exhausted || sawEveryAddedRow || coveredLoadedWindow) break
    const next = await fetchPage(offset)
    take(next.data)
    offset += next.data.length
    lastPageLength = next.data.length
  }

  return { rows: mergeFirstPage(existing, fetched), total }
}
