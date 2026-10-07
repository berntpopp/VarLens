/**
 * Merge a freshly fetched first page into an already loaded, newest-first
 * list without clearing it.
 *
 * Used when rows are added while the list is on screen (a case finishes
 * importing): the new rows appear on top, rows that were already loaded keep
 * their place below them and take the fresh copy, and nothing is duplicated.
 * The length of the result is the offset of the next page to fetch, provided
 * no more than one page of rows was added since the previous merge.
 */
export function mergeFirstPage<T extends { id: number }>(existing: T[], firstPage: T[]): T[] {
  const fresh = new Set(firstPage.map((row) => row.id))
  return [...firstPage, ...existing.filter((row) => !fresh.has(row.id))]
}
