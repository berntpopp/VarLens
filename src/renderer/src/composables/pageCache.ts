/**
 * Small LRU cache for table pages (used by useOffsetPagination).
 *
 * Reads do not evict: a page fetched or prefetched once can be revisited
 * (prev/next/back) without another round trip until the cache is cleared by
 * a filter, sort or page-size change.
 */
export interface PageCache<V> {
  get(key: string): V | undefined
  has(key: string): boolean
  set(key: string, value: V): void
  delete(key: string): void
  clear(): void
  readonly size: number
}

export function createPageCache<V>(maxEntries = 8): PageCache<V> {
  const map = new Map<string, V>()
  return {
    get(key) {
      const value = map.get(key)
      if (value !== undefined) {
        // Refresh recency: Map iteration order is insertion order.
        map.delete(key)
        map.set(key, value)
      }
      return value
    },
    has: (key) => map.has(key),
    set(key, value) {
      map.delete(key)
      map.set(key, value)
      while (map.size > maxEntries) {
        const oldest = map.keys().next().value
        if (oldest === undefined) break
        map.delete(oldest)
      }
    },
    delete: (key) => {
      map.delete(key)
    },
    clear: () => map.clear(),
    get size() {
      return map.size
    }
  }
}

/** Run `fn` when the main thread is idle (falls back to a macrotask). */
export function runWhenIdle(fn: () => void): void {
  const ric = (
    globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
  ).requestIdleCallback
  if (typeof ric === 'function') ric(fn, { timeout: 1000 })
  else setTimeout(fn, 0)
}
