/**
 * Process-wide response cache for the web server's reference lookups.
 *
 * Same interface as the desktop ApiCache (the API clients call get/set/
 * clearByPrefix on it), backed by an in-memory SQLite table, but BOUNDED:
 *
 *   - TTL: entries live at most `maxTtlDays` (default 7), even when a client
 *     asks for longer (desktop caches for 30 days on the user's own disk);
 *   - size: at most `maxEntries` rows (default 5000); the least recently
 *     used rows are evicted first (`get` refreshes `last_used`).
 *
 * Shared across users, so many sessions looking at the same gene or variant
 * reach the upstream API once.
 */
import Database from 'better-sqlite3-multiple-ciphers'

import { ApiCache } from '../../../main/services/api/ApiCache'

export interface BoundedApiCacheOptions {
  maxEntries?: number
  maxTtlDays?: number
  now?: () => number
}

export const DEFAULT_CACHE_MAX_ENTRIES = 5000
export const DEFAULT_CACHE_MAX_TTL_DAYS = 7

function createCacheDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE api_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cache_key TEXT NOT NULL UNIQUE,
      response_data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_used INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_api_cache_expires ON api_cache(expires_at);
    CREATE INDEX idx_api_cache_last_used ON api_cache(last_used);
  `)
  return db
}

export class BoundedApiCache extends ApiCache {
  private readonly cacheDb: Database.Database
  private readonly maxEntries: number
  private readonly maxTtlDays: number
  private readonly now: () => number

  constructor(options: BoundedApiCacheOptions = {}) {
    const db = createCacheDb()
    super(db)
    this.cacheDb = db
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_CACHE_MAX_ENTRIES)
    this.maxTtlDays = Math.max(0, options.maxTtlDays ?? DEFAULT_CACHE_MAX_TTL_DAYS)
    this.now = options.now ?? Date.now
  }

  override get(key: string): { data: string; createdAt: number } | null {
    const hit = super.get(key)
    if (hit !== null) {
      this.cacheDb
        .prepare('UPDATE api_cache SET last_used = ? WHERE cache_key = ?')
        .run(this.now(), key)
    }
    return hit
  }

  override set(key: string, data: string, ttlDays?: number): void {
    super.set(key, data, Math.min(ttlDays ?? this.maxTtlDays, this.maxTtlDays))
    this.cacheDb
      .prepare('UPDATE api_cache SET last_used = ? WHERE cache_key = ?')
      .run(this.now(), key)
    this.evict()
  }

  /** Close the in-memory database (server shutdown). */
  close(): void {
    if (this.cacheDb.open) this.cacheDb.close()
  }

  /** Number of cached responses (tests / metrics). */
  size(): number {
    return (this.cacheDb.prepare('SELECT COUNT(*) AS c FROM api_cache').get() as { c: number }).c
  }

  private evict(): void {
    this.cleanupExpired()
    const overflow = this.size() - this.maxEntries
    if (overflow <= 0) return
    this.cacheDb
      .prepare(
        `DELETE FROM api_cache WHERE id IN (
           SELECT id FROM api_cache ORDER BY last_used ASC, id ASC LIMIT ?
         )`
      )
      .run(overflow)
  }
}
