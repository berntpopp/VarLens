/**
 * Simple LRU cache backed by a JavaScript Map.
 *
 * Map preserves insertion order, so the first key is always the oldest.
 * On `get()`, the accessed entry is moved to the end (most-recently-used).
 * On `set()`, entries beyond `maxSize` are evicted from the front (oldest).
 */
export class LruMap<K, V> {
  private readonly map = new Map<K, V>()
  readonly maxSize: number

  constructor(maxSize: number) {
    if (maxSize < 1) throw new RangeError('maxSize must be >= 1')
    this.maxSize = maxSize
  }

  get size(): number {
    return this.map.size
  }

  get(key: K): V | undefined {
    const value = this.map.get(key)
    if (value !== undefined) {
      // Move to end (most recently used)
      this.map.delete(key)
      this.map.set(key, value)
    }
    return value
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key)
    }
    this.map.set(key, value)
    while (this.map.size > this.maxSize) {
      const oldestKey = this.map.keys().next().value
      if (oldestKey === undefined) break
      this.map.delete(oldestKey)
    }
  }

  has(key: K): boolean {
    return this.map.has(key)
  }

  delete(key: K): boolean {
    return this.map.delete(key)
  }

  clear(): void {
    this.map.clear()
  }

  values(): IterableIterator<V> {
    return this.map.values()
  }

  keys(): IterableIterator<K> {
    return this.map.keys()
  }
}
