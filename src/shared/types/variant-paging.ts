/**
 * Optional keyset ("seek") paging for the case variant list.
 *
 * Opt-in: a client that understands cursors passes `cursor` ('' for a page
 * it has no cursor for). Clients that pass nothing get the unchanged
 * OFFSET response shape.
 *
 * Request: pass the previous page's `next_cursor` as `cursor` when asking
 * for the page that directly follows it (same filter, sort and page size).
 * The server then resumes after that row instead of scanning `offset` rows.
 *
 * Response: `next_cursor` is present when the sort is keyset-eligible and
 * the page was full; `paging: 'keyset'` is set only when the cursor was
 * honoured (absent = OFFSET served the page).
 * Cursors are opaque, bound to the filter + sort that produced them, and
 * silently ignored (OFFSET fallback) when stale or unsupported — so passing
 * one is always safe. Backends without keyset support (desktop SQLite)
 * ignore the cursor and never return `next_cursor`.
 */
export interface VariantPageRequest {
  cursor?: string
}

export interface VariantPageResult {
  next_cursor?: string
  paging?: 'keyset'
}
