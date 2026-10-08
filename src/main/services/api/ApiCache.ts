/**
 * API response cache service with SQLite backend
 *
 * Provides persistent caching for VEP and HPO API responses with TTL expiration.
 * Uses prepared statements for performance and implements TTL jitter to prevent
 * thundering herd on cache expiration.
 */

import type Database from 'better-sqlite3-multiple-ciphers'
import type { CacheSizeInfo } from '../../../shared/types/api-enrichment'
import { DATABASE_CONFIG } from '../../../shared/config'

interface CacheEntry {
  response_data: string
  created_at: number
}

interface CacheStatements {
  get: Database.Statement
  set: Database.Statement
  deleteByPrefix: Database.Statement
  cleanupExpired: Database.Statement
  getCacheStats: Database.Statement
}

// Prepare statements once per connection - avoid reparsing SQL on each call
function prepareStatements(db: Database.Database): CacheStatements {
  return {
    get: db.prepare(`
      SELECT response_data, created_at
      FROM api_cache
      WHERE cache_key = ? AND expires_at > ?
    `),
    set: db.prepare(`
      INSERT INTO api_cache (cache_key, response_data, created_at, expires_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        response_data = excluded.response_data,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at
    `),
    deleteByPrefix: db.prepare(`
      DELETE FROM api_cache WHERE cache_key LIKE ?
    `),
    cleanupExpired: db.prepare(`
      DELETE FROM api_cache WHERE expires_at <= ?
    `),
    getCacheStats: db.prepare(`
      SELECT
        SUM(CASE WHEN cache_key LIKE 'vep:%' THEN 1 ELSE 0 END) as vep_count,
        SUM(CASE WHEN cache_key LIKE 'hpo:%' THEN 1 ELSE 0 END) as hpo_count,
        SUM(LENGTH(response_data)) as total_bytes
      FROM api_cache
    `)
  }
}

export class ApiCache {
  private readonly statements = new WeakMap<Database.Database, CacheStatements>()

  /**
   * @param source - A connection, or a getter for the current one. Long-lived
   *   owners (IPC handlers) pass the getter so the cache follows a database
   *   switch instead of holding statements of a closed connection.
   */
  constructor(private readonly source: Database.Database | (() => Database.Database)) {}

  private get db(): Database.Database {
    return typeof this.source === 'function' ? this.source() : this.source
  }

  private get stmts(): CacheStatements {
    const db = this.db
    let stmts = this.statements.get(db)
    if (!stmts) {
      stmts = prepareStatements(db)
      this.statements.set(db, stmts)
    }
    return stmts
  }

  /**
   * Get cached response by key
   * Returns null if key doesn't exist or entry is expired
   */
  get(key: string): { data: string; createdAt: number } | null {
    const now = Date.now()
    const result = this.stmts.get.get(key, now) as CacheEntry | undefined

    if (!result) return null

    return {
      data: result.response_data,
      createdAt: result.created_at
    }
  }

  /**
   * Set cache entry with TTL
   * Adds jitter to TTL to prevent thundering herd on expiration
   *
   * @param key - Cache key (e.g., "vep:chr1:100:A:T")
   * @param data - JSON string to cache
   * @param ttlDays - Time-to-live in days (default 30)
   */
  set(key: string, data: string, ttlDays: number = DATABASE_CONFIG.CACHE_TTL_DAYS): void {
    const now = Date.now()

    // Add TTL jitter: ±10% to spread expiration times
    // Prevents many cache entries expiring simultaneously
    const jitterFactor = 0.9 + Math.random() * 0.2 // 0.9 to 1.1
    const ttlMs = ttlDays * 24 * 60 * 60 * 1000 * jitterFactor
    const expiresAt = now + ttlMs

    this.runWithoutLockWait(() => this.stmts.set.run(key, data, now, expiresAt))
  }

  /**
   * Cache writes happen on the Electron main thread's connection. Waiting up
   * to `busy_timeout` there while an import/delete worker holds the write
   * lock would freeze the whole app, and a cache entry is only an
   * optimisation — so the write is attempted without waiting and skipped
   * when the database is locked.
   */
  private runWithoutLockWait(write: () => void): void {
    const previous = this.db.pragma('busy_timeout', { simple: true }) as number
    this.db.pragma('busy_timeout = 0')
    try {
      write()
    } catch (error) {
      const code = (error as { code?: unknown }).code
      if (typeof code !== 'string' || !code.startsWith('SQLITE_BUSY')) throw error
    } finally {
      this.db.pragma(`busy_timeout = ${previous}`)
    }
  }

  /**
   * Clear all cache entries with a specific prefix
   *
   * @param prefix - Key prefix ('vep:' or 'hpo:')
   * @returns Number of entries deleted
   */
  clearByPrefix(
    prefix:
      | 'vep:'
      | 'hpo:'
      | 'myvariant:'
      | 'spliceai:'
      | 'uniprot:'
      | 'alphafold:'
      | 'interpro:'
      | 'gnomad:'
      | 'clinvar:'
      | 'ensembl:'
  ): number {
    const result = this.stmts.deleteByPrefix.run(`${prefix}%`)
    return result.changes
  }

  /**
   * Remove expired cache entries
   * Should be called periodically (e.g., on app startup)
   *
   * @returns Number of entries deleted
   */
  cleanupExpired(): number {
    const now = Date.now()
    const result = this.stmts.cleanupExpired.run(now)
    return result.changes
  }

  /**
   * Get cache statistics for settings page
   */
  getCacheStats(): CacheSizeInfo {
    const result = this.stmts.getCacheStats.get() as {
      vep_count: number | null
      hpo_count: number | null
      total_bytes: number | null
    }

    return {
      vepCount: result.vep_count ?? 0,
      hpoCount: result.hpo_count ?? 0,
      totalBytes: result.total_bytes ?? 0
    }
  }
}
