/**
 * Tests for HPO API client
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import nock from 'nock'
import Database from 'better-sqlite3-multiple-ciphers'
import { HpoApiClient } from '../../../../src/main/services/api/HpoApiClient'
import { ApiCache } from '../../../../src/main/services/api/ApiCache'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdtempSync, rmSync } from 'fs'

describe('HpoApiClient', () => {
  let db: Database.Database
  let cache: ApiCache
  let client: HpoApiClient
  let tempDir: string

  beforeEach(() => {
    // Create temp database for testing
    tempDir = mkdtempSync(join(tmpdir(), 'hpo-test-'))
    db = new Database(join(tempDir, 'test.db'))

    // Create api_cache table
    db.exec(`
      CREATE TABLE api_cache (
        cache_key TEXT PRIMARY KEY,
        response_data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `)

    cache = new ApiCache(db)
    client = new HpoApiClient(cache)

    // Suppress console.log during tests
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    nock.cleanAll()
    db.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('searches HPO terms successfully', async () => {
    // Mock NLM Clinical Tables API response
    nock('https://clinicaltables.nlm.nih.gov')
      .get('/api/hpo/v3/search')
      .query({ terms: 'seizure', count: '20', df: 'id,name' })
      .reply(200, [
        2, // total count
        ['HP:0001250', 'HP:0002373'], // id array
        null, // extra data
        [
          ['HP:0001250', 'Seizure'],
          ['HP:0002373', 'Febrile seizure']
        ]
      ])

    const result = await client.search('seizure')

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.terms).toHaveLength(2)
      expect(result.terms[0]).toEqual({ id: 'HP:0001250', name: 'Seizure' })
      expect(result.terms[1]).toEqual({ id: 'HP:0002373', name: 'Febrile seizure' })
    }
  })

  it('returns empty array for query too short', async () => {
    // Should not make API call - no nock mock needed
    const result = await client.search('s')

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.terms).toEqual([])
    }
  })

  it('returns cached data on cache hit', async () => {
    // First request - populate cache
    nock('https://clinicaltables.nlm.nih.gov')
      .get('/api/hpo/v3/search')
      .query({ terms: 'ataxia', count: '20', df: 'id,name' })
      .reply(200, [1, ['HP:0001251'], null, [['HP:0001251', 'Ataxia']]])

    const result1 = await client.search('ataxia')
    expect(result1.success).toBe(true)

    // Second request - should use cache (no new mock needed)
    const result2 = await client.search('ataxia')

    expect(result2.success).toBe(true)
    if (result2.success) {
      expect(result2.terms).toEqual([{ id: 'HP:0001251', name: 'Ataxia' }])
    }
  })

  it('enforces courtesy delay between requests', async () => {
    // Mock two API calls
    nock('https://clinicaltables.nlm.nih.gov')
      .get('/api/hpo/v3/search')
      .query({ terms: 'ataxia', count: '20', df: 'id,name' })
      .reply(200, [1, ['HP:0001251'], null, [['HP:0001251', 'Ataxia']]])

    nock('https://clinicaltables.nlm.nih.gov')
      .get('/api/hpo/v3/search')
      .query({ terms: 'myopathy', count: '20', df: 'id,name' })
      .reply(200, [1, ['HP:0003198'], null, [['HP:0003198', 'Myopathy']]])

    const start = Date.now()

    await client.search('ataxia')
    await client.search('myopathy')

    const elapsed = Date.now() - start

    // Should take at least 200ms due to courtesy delay
    expect(elapsed).toBeGreaterThanOrEqual(190) // Allow 10ms tolerance
  })

  it('handles API timeout', async () => {
    // Mock slow API response
    nock('https://clinicaltables.nlm.nih.gov')
      .get('/api/hpo/v3/search')
      .query({ terms: 'slow', count: '20', df: 'id,name' })
      .delay(11000) // Delay longer than 10s timeout
      .reply(200, [0, [], null, []])

    const result = await client.search('slow')

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain('abort')
    }
  })

  it('getCached returns cached terms', async () => {
    // Populate cache
    nock('https://clinicaltables.nlm.nih.gov')
      .get('/api/hpo/v3/search')
      .query({ terms: 'tremor', count: '20', df: 'id,name' })
      .reply(200, [1, ['HP:0001337'], null, [['HP:0001337', 'Tremor']]])

    await client.search('tremor')

    // Get from cache
    const cached = client.getCached('tremor', 20)

    expect(cached).toEqual([{ id: 'HP:0001337', name: 'Tremor' }])
  })

  it('getCached returns null for uncached query', () => {
    const cached = client.getCached('notcached', 20)
    expect(cached).toBeNull()
  })

  it('getCached returns empty array for short query', () => {
    const cached = client.getCached('x', 20)
    expect(cached).toEqual([])
  })

  it('clearCache removes all HPO entries', async () => {
    // Populate cache with multiple queries
    nock('https://clinicaltables.nlm.nih.gov')
      .get('/api/hpo/v3/search')
      .query({ terms: 'query1', count: '20', df: 'id,name' })
      .reply(200, [1, ['HP:0000001'], null, [['HP:0000001', 'All']]])

    nock('https://clinicaltables.nlm.nih.gov')
      .get('/api/hpo/v3/search')
      .query({ terms: 'query2', count: '20', df: 'id,name' })
      .reply(200, [1, ['HP:0000002'], null, [['HP:0000002', 'Abnormality']]])

    await client.search('query1')
    await client.search('query2')

    // Verify cached
    expect(client.getCached('query1', 20)).not.toBeNull()
    expect(client.getCached('query2', 20)).not.toBeNull()

    // Clear cache
    client.clearCache()

    // Verify cleared
    expect(client.getCached('query1', 20)).toBeNull()
    expect(client.getCached('query2', 20)).toBeNull()
  })

  it('handles API error response', async () => {
    nock('https://clinicaltables.nlm.nih.gov')
      .get('/api/hpo/v3/search')
      .query({ terms: 'error', count: '20', df: 'id,name' })
      .reply(500, 'Internal Server Error')

    const result = await client.search('error')

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain('500')
    }
  })
})
