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
 * reload. So this pages from the top until it reaches a row that was already
 * loaded. The growth of the total is not a reliable page count on its own
 * (cases deleted meanwhile shrink it), but it is used on top: paging goes on
 * past the first known row while added rows are still unaccounted for, up to
 * the end of the loaded window. That finds a case that became visible below
 * newer ones, as parallel imports publish in a different order than the
 * cases were created.
 *
 * Loaded rows that the re-read part of the list no longer contains were
 * deleted on the server and are dropped. The result is a gap-free prefix of
 * the server list, so its length is the offset of the next infinite-scroll
 * page.
 */
export async function refreshNewestRows<T extends { id: number }>(args: {
  existing: T[]
  /** Total the list reported at its previous load or refresh. */
  previousTotal: number
  pageSize: number
  fetchPage: (offset: number) => Promise<Page<T>>
}): Promise<{ rows: T[]; total: number }> {
  const { existing, previousTotal, pageSize, fetchPage } = args
  const position = new Map(existing.map((row, index) => [row.id, index]))
  const first = await fetchPage(0)
  const total = first.total_count
  const added = Math.max(0, total - previousTotal)

  const fetched: T[] = []
  const fetchedIds = new Set<number>()
  let unseen = 0
  /** Position, in the loaded list, of the deepest loaded row that was re-read. */
  let deepestKnown = -1
  const take = (rows: T[]): void => {
    for (const row of rows) {
      // A row can shift onto the next page while we are paging.
      if (fetchedIds.has(row.id)) continue
      fetchedIds.add(row.id)
      fetched.push(row)
      const at = position.get(row.id)
      if (at === undefined) unseen++
      else deepestKnown = Math.max(deepestKnown, at)
    }
  }
  take(first.data)

  let offset = first.data.length
  let lastPageLength = first.data.length
  for (let page = 1; page < MAX_PAGES; page++) {
    const exhausted = lastPageLength < pageSize
    // Nothing loaded before: this is a first page, not a refresh.
    const reachedLoadedRows = deepestKnown >= 0 || existing.length === 0
    const sawEveryAddedRow = unseen >= added
    const coveredLoadedWindow = fetched.length >= existing.length + unseen
    if (exhausted || (reachedLoadedRows && (sawEveryAddedRow || coveredLoadedWindow))) break
    const next = await fetchPage(offset)
    take(next.data)
    offset += next.data.length
    lastPageLength = next.data.length
  }

  // Loaded rows above the deepest re-read one that did not come back are gone.
  const stillBelow = existing.slice(deepestKnown + 1)
  return { rows: mergeFirstPage(stillBelow, fetched), total }
}
