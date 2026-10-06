/**
 * Short-TTL, single-flight cache for the per-request live-user check.
 *
 * Every authenticated `/api/*` call revalidates the session cookie against
 * the `users` row (deactivation / password reset must kill stale sessions).
 * Doing that as a DB round-trip per request cost one of the pool's
 * connections on every call (05-blocking-analysis.md, W-5). This cache keeps
 * the answer for a few seconds and collapses concurrent lookups for the same
 * user into one query.
 *
 * Staleness contract:
 *   - Mutations routed through this process (deactivate, reset, change
 *     password, login, logout) invalidate the entry synchronously, so the
 *     next request re-reads the row.
 *   - Mutations made elsewhere (another replica, a SQL console) become
 *     visible after at most `ttlMs`.
 *   - `ttlMs = 0` disables caching entirely (every call hits the loader).
 *
 * A generation counter per key stops an in-flight load that started before
 * an invalidation from repopulating the cache with the pre-invalidation row.
 */

export const DEFAULT_AUTH_USER_CACHE_TTL_MS = 5000
export const AUTH_USER_CACHE_TTL_ENV = 'VARLENS_AUTH_USER_CACHE_TTL_MS'
const MAX_AUTH_USER_CACHE_TTL_MS = 60_000

interface CacheEntry<V> {
  value: V
  expiresAt: number
}

export interface UserLookupCacheOptions {
  ttlMs: number
  /** Upper bound on cached keys; the oldest entry is evicted beyond it. */
  maxEntries?: number
  now?: () => number
}

export class UserLookupCache<V> {
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly now: () => number
  private readonly entries = new Map<string, CacheEntry<V>>()
  private readonly inFlight = new Map<string, Promise<V>>()
  private readonly generations = new Map<string, number>()

  constructor(options: UserLookupCacheOptions) {
    this.ttlMs = Math.max(0, options.ttlMs)
    this.maxEntries = options.maxEntries ?? 1000
    this.now = options.now ?? Date.now
  }

  get enabled(): boolean {
    return this.ttlMs > 0
  }

  async get(key: string, load: () => Promise<V>): Promise<V> {
    if (!this.enabled) return load()

    const cached = this.entries.get(key)
    if (cached !== undefined && cached.expiresAt > this.now()) return cached.value

    const pending = this.inFlight.get(key)
    if (pending !== undefined) return pending

    const generation = this.generations.get(key) ?? 0
    const promise = load().then((value) => {
      if ((this.generations.get(key) ?? 0) === generation) {
        this.store(key, value)
      }
      return value
    })
    this.inFlight.set(key, promise)
    try {
      return await promise
    } finally {
      if (this.inFlight.get(key) === promise) this.inFlight.delete(key)
    }
  }

  invalidate(key: string): void {
    this.entries.delete(key)
    this.inFlight.delete(key)
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1)
  }

  clear(): void {
    for (const key of new Set([...this.entries.keys(), ...this.inFlight.keys()])) {
      this.invalidate(key)
    }
  }

  private store(key: string, value: V): void {
    this.entries.delete(key)
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs })
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }
}

/** Parse `VARLENS_AUTH_USER_CACHE_TTL_MS` (integer ms, 0 disables, max 60 s). */
export function resolveAuthUserCacheTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[AUTH_USER_CACHE_TTL_ENV]
  if (raw === undefined || raw.trim() === '') return DEFAULT_AUTH_USER_CACHE_TTL_MS
  const value = Number(raw.trim())
  if (!Number.isInteger(value) || value < 0 || value > MAX_AUTH_USER_CACHE_TTL_MS) {
    throw new Error(
      `${AUTH_USER_CACHE_TTL_ENV} must be an integer between 0 and ${MAX_AUTH_USER_CACHE_TTL_MS}; got ${raw}`
    )
  }
  return value
}
