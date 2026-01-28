/**
 * Tests for ApiCache service
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { tmpdir } from 'os'
import { join } from 'path'
import { unlinkSync, existsSync } from 'fs'
import { ApiCache } from '../../../../src/main/services/api/ApiCache'

describe('ApiCache', () => {
  let db: Database.Database
  let cache: ApiCache
  let tempDbPath: string

  beforeEach(() => {
    // Create temporary in-memory database for each test
    tempDbPath = join(tmpdir(), `test-cache-${Date.now()}.db`)
    db = new Database(tempDbPath)

    // Create api_cache table schema
    db.exec(`
      CREATE TABLE api_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cache_key TEXT NOT NULL UNIQUE,
        response_data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE INDEX idx_api_cache_key ON api_cache(cache_key);
      CREATE INDEX idx_api_cache_expires ON api_cache(expires_at);
    `)

    cache = new ApiCache(db)
  })

  afterEach(() => {
    db.close()
    if (existsSync(tempDbPath)) {
      unlinkSync(tempDbPath)
    }
  })

  describe('set and get', () => {
    it('should store and retrieve cached data', () => {
      const key = 'vep:chr1:100:A:T'
      const data = JSON.stringify({ test: 'data', score: 25.3 })

      cache.set(key, data, 30)

      const result = cache.get(key)
      expect(result).toBeTruthy()
      expect(result!.data).toBe(data)
      expect(result!.createdAt).toBeGreaterThan(0)
    })

    it('should return null for non-existent key', () => {
      const result = cache.get('vep:chr1:999:X:Y')
      expect(result).toBeNull()
    })

    it('should update existing cache entry on duplicate key', () => {
      const key = 'vep:chr2:200:G:C'
      const data1 = JSON.stringify({ version: 1 })
      const data2 = JSON.stringify({ version: 2 })

      cache.set(key, data1, 30)
      const result1 = cache.get(key)
      expect(JSON.parse(result1!.data).version).toBe(1)

      // Wait a bit to ensure different timestamp
      cache.set(key, data2, 30)
      const result2 = cache.get(key)
      expect(JSON.parse(result2!.data).version).toBe(2)
      expect(result2!.createdAt).toBeGreaterThanOrEqual(result1!.createdAt)
    })
  })

  describe('TTL expiration', () => {
    it('should return null for expired entries', async () => {
      const key = 'vep:chr3:300:T:A'
      const data = JSON.stringify({ test: 'expired' })

      // Manually insert entry with past expiration time to avoid jitter issues
      const now = Date.now()
      const pastExpiration = now - 1000 // Expired 1 second ago

      db.prepare(
        'INSERT INTO api_cache (cache_key, response_data, created_at, expires_at) VALUES (?, ?, ?, ?)'
      ).run(key, data, now - 2000, pastExpiration)

      // Should return null for expired entry
      const result = cache.get(key)
      expect(result).toBeNull()
    })

    it('should add TTL jitter between 27-33 days for 30-day TTL', () => {
      const key1 = 'vep:chr4:400:A:G'
      const key2 = 'vep:chr4:401:A:G'
      const key3 = 'vep:chr4:402:A:G'

      const ttlDays = 30
      const expectedMinMs = 27 * 24 * 60 * 60 * 1000
      const expectedMaxMs = 33 * 24 * 60 * 60 * 1000

      const now = Date.now()

      cache.set(key1, 'test1', ttlDays)
      cache.set(key2, 'test2', ttlDays)
      cache.set(key3, 'test3', ttlDays)

      // Check actual expiration times in database
      const rows = db
        .prepare('SELECT cache_key, expires_at FROM api_cache WHERE cache_key LIKE ?')
        .all('vep:chr4:40%') as Array<{ cache_key: string; expires_at: number }>

      expect(rows).toHaveLength(3)

      rows.forEach((row) => {
        const actualTtlMs = row.expires_at - now
        expect(actualTtlMs).toBeGreaterThanOrEqual(expectedMinMs)
        expect(actualTtlMs).toBeLessThanOrEqual(expectedMaxMs)
      })
    })
  })

  describe('clearByPrefix', () => {
    it('should clear only VEP cache entries', () => {
      cache.set('vep:chr1:100:A:T', 'vep1', 30)
      cache.set('vep:chr1:200:G:C', 'vep2', 30)
      cache.set('hpo:seizure', 'hpo1', 30)

      const deleted = cache.clearByPrefix('vep:')
      expect(deleted).toBe(2)

      expect(cache.get('vep:chr1:100:A:T')).toBeNull()
      expect(cache.get('vep:chr1:200:G:C')).toBeNull()
      expect(cache.get('hpo:seizure')).toBeTruthy()
    })

    it('should clear only HPO cache entries', () => {
      cache.set('vep:chr1:100:A:T', 'vep1', 30)
      cache.set('hpo:seizure', 'hpo1', 30)
      cache.set('hpo:apnea', 'hpo2', 30)

      const deleted = cache.clearByPrefix('hpo:')
      expect(deleted).toBe(2)

      expect(cache.get('vep:chr1:100:A:T')).toBeTruthy()
      expect(cache.get('hpo:seizure')).toBeNull()
      expect(cache.get('hpo:apnea')).toBeNull()
    })

    it('should return 0 when no matching entries', () => {
      cache.set('vep:chr1:100:A:T', 'vep1', 30)

      const deleted = cache.clearByPrefix('hpo:')
      expect(deleted).toBe(0)
    })
  })

  describe('cleanupExpired', () => {
    it('should remove only expired entries', () => {
      const now = Date.now()

      // Insert valid entry (expires in future)
      db.prepare(
        'INSERT INTO api_cache (cache_key, response_data, created_at, expires_at) VALUES (?, ?, ?, ?)'
      ).run('vep:chr1:100:A:T', 'valid', now, now + 30 * 24 * 60 * 60 * 1000)

      // Insert expired entry (expired in past)
      db.prepare(
        'INSERT INTO api_cache (cache_key, response_data, created_at, expires_at) VALUES (?, ?, ?, ?)'
      ).run('vep:chr1:200:G:C', 'expired', now - 2000, now - 1000)

      const deleted = cache.cleanupExpired()
      expect(deleted).toBe(1)

      expect(cache.get('vep:chr1:100:A:T')).toBeTruthy()
      expect(cache.get('vep:chr1:200:G:C')).toBeNull()
    })

    it('should return 0 when no expired entries', () => {
      cache.set('vep:chr1:100:A:T', 'valid', 30)
      cache.set('hpo:seizure', 'valid', 30)

      const deleted = cache.cleanupExpired()
      expect(deleted).toBe(0)
    })
  })

  describe('getCacheStats', () => {
    it('should return correct counts for VEP and HPO entries', () => {
      cache.set('vep:chr1:100:A:T', 'a'.repeat(100), 30)
      cache.set('vep:chr1:200:G:C', 'b'.repeat(200), 30)
      cache.set('hpo:seizure', 'c'.repeat(50), 30)

      const stats = cache.getCacheStats()
      expect(stats.vepCount).toBe(2)
      expect(stats.hpoCount).toBe(1)
      expect(stats.totalBytes).toBe(350) // 100 + 200 + 50
    })

    it('should return zeros for empty cache', () => {
      const stats = cache.getCacheStats()
      expect(stats.vepCount).toBe(0)
      expect(stats.hpoCount).toBe(0)
      expect(stats.totalBytes).toBe(0)
    })

    it('should calculate total bytes correctly', () => {
      const vepData = JSON.stringify({ large: 'x'.repeat(1000) })
      const hpoData = JSON.stringify({ small: 'y'.repeat(50) })

      cache.set('vep:chr1:100:A:T', vepData, 30)
      cache.set('hpo:term', hpoData, 30)

      const stats = cache.getCacheStats()
      expect(stats.totalBytes).toBe(vepData.length + hpoData.length)
    })
  })
})
