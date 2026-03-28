/**
 * Tests for InterProApiClient
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import nock from 'nock'
import Database from 'better-sqlite3-multiple-ciphers'
import { tmpdir } from 'os'
import { join } from 'path'
import { unlinkSync } from 'fs'
import { ApiCache } from '../../../../src/main/services/api/ApiCache'
import { InterProApiClient } from '../../../../src/main/services/api/InterProApiClient'

describe('InterProApiClient', () => {
  let db: Database.Database
  let cache: ApiCache
  let client: InterProApiClient
  let tempDbPath: string

  // Sample InterPro response with domain and family entries
  const mockInterProResponse = {
    count: 2,
    results: [
      {
        metadata: {
          accession: 'IPR011615',
          name: 'p53, DNA-binding domain',
          type: 'domain',
          source_database: 'interpro'
        },
        proteins: [
          {
            accession: 'p04637',
            protein_length: 393,
            entry_protein_locations: [
              {
                fragments: [{ start: 100, end: 288, 'dc-status': 'CONTINUOUS' }]
              }
            ]
          }
        ]
      },
      {
        metadata: {
          accession: 'IPR002117',
          name: 'p53 tumour suppressor family',
          type: 'family',
          source_database: 'interpro'
        },
        proteins: [
          {
            accession: 'p04637',
            protein_length: 393,
            entry_protein_locations: [
              {
                fragments: [{ start: 1, end: 393, 'dc-status': 'CONTINUOUS' }]
              }
            ]
          }
        ]
      }
    ]
  }

  const mockMultiTypeResponse = {
    count: 3,
    results: [
      {
        metadata: {
          accession: 'IPR011615',
          name: 'p53, DNA-binding domain',
          type: 'domain',
          source_database: 'interpro'
        },
        proteins: [
          {
            accession: 'P04637',
            protein_length: 393,
            entry_protein_locations: [{ fragments: [{ start: 100, end: 288 }] }]
          }
        ]
      },
      {
        metadata: {
          accession: 'IPR013872',
          name: 'p53 transactivation domain',
          type: 'region',
          source_database: 'interpro'
        },
        proteins: [
          {
            accession: 'P04637',
            protein_length: 393,
            entry_protein_locations: [{ fragments: [{ start: 1, end: 67 }] }]
          }
        ]
      },
      {
        metadata: {
          accession: 'IPR008967',
          name: 'p53-like motif',
          type: 'motif',
          source_database: 'interpro'
        },
        proteins: [
          {
            accession: 'P04637',
            protein_length: 393,
            entry_protein_locations: [{ fragments: [{ start: 300, end: 393 }] }]
          }
        ]
      }
    ]
  }

  beforeEach(() => {
    // Create temp database for each test
    tempDbPath = join(tmpdir(), `interpro-test-${Date.now()}.db`)
    db = new Database(tempDbPath)

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
    client = new InterProApiClient(cache)

    // Enable nock for HTTP mocking
    nock.disableNetConnect()
  })

  afterEach(() => {
    // Clean up
    db.close()
    try {
      unlinkSync(tempDbPath)
    } catch {
      // Ignore if file doesn't exist
    }
    nock.cleanAll()
    nock.enableNetConnect()
  })

  describe('fetchDomains', () => {
    it('should fetch and filter domains by type (include domain, exclude family)', async () => {
      nock('https://www.ebi.ac.uk')
        .get('/interpro/api/entry/interpro/protein/uniprot/P04637')
        .reply(200, mockInterProResponse)

      const result = await client.fetchDomains('P04637')

      expect(result.success).toBe(true)
      if (result.success) {
        // Should include 'domain' type but not 'family'
        expect(result.domains).toHaveLength(1)
        expect(result.domains[0].accession).toBe('IPR011615')
        expect(result.domains[0].name).toBe('p53, DNA-binding domain')
        expect(result.domains[0].type).toBe('domain')
        expect(result.domains[0].start).toBe(100)
        expect(result.domains[0].end).toBe(288)
        expect(result.proteinLength).toBe(393)
        expect(result.cacheInfo.cached).toBe(false)
      }
    })

    it('should normalize accession to uppercase for cache key', async () => {
      nock('https://www.ebi.ac.uk')
        .get('/interpro/api/entry/interpro/protein/uniprot/P04637')
        .reply(200, mockInterProResponse)

      await client.fetchDomains('p04637')

      // Check that cache key was normalized (uppercase)
      const cached = cache.get('interpro:P04637')
      expect(cached).not.toBe(null)
    })

    it('should return cached result on second call', async () => {
      nock('https://www.ebi.ac.uk')
        .get('/interpro/api/entry/interpro/protein/uniprot/P04637')
        .reply(200, mockInterProResponse)

      // First call — fetches from network
      await client.fetchDomains('P04637')

      // Second call — should use cache, no new HTTP request needed
      const result = await client.fetchDomains('P04637')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.cacheInfo.cached).toBe(true)
        expect(result.cacheInfo.cachedAt).toBeTypeOf('number')
        expect(result.domains).toHaveLength(1)
      }

      // Verify nock was only called once (second call used cache)
      expect(nock.activeMocks()).toHaveLength(0)
    })

    it('should return cached result when pre-populated', async () => {
      // Pre-populate cache (no nock mock needed)
      const cacheKey = 'interpro:P04637'
      cache.set(cacheKey, JSON.stringify(mockInterProResponse), 90)

      const result = await client.fetchDomains('P04637')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.cacheInfo.cached).toBe(true)
        expect(result.cacheInfo.cachedAt).toBeTypeOf('number')
        expect(result.domains).toHaveLength(1)
      }

      // Verify no HTTP requests were made
      expect(nock.activeMocks()).toHaveLength(0)
    })

    it('should include all domain-like types: domain, region, motif', async () => {
      nock('https://www.ebi.ac.uk')
        .get('/interpro/api/entry/interpro/protein/uniprot/P04637')
        .reply(200, mockMultiTypeResponse)

      const result = await client.fetchDomains('P04637')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.domains).toHaveLength(3)

        const types = result.domains.map((d) => d.type)
        expect(types).toContain('domain')
        expect(types).toContain('region')
        expect(types).toContain('motif')
      }
    })

    it('should exclude homologous_superfamily entries', async () => {
      const mockWithSuperfamily = {
        count: 2,
        results: [
          {
            metadata: {
              accession: 'IPR011615',
              name: 'p53, DNA-binding domain',
              type: 'domain',
              source_database: 'interpro'
            },
            proteins: [
              {
                accession: 'P04637',
                protein_length: 393,
                entry_protein_locations: [{ fragments: [{ start: 100, end: 288 }] }]
              }
            ]
          },
          {
            metadata: {
              accession: 'IPR036674',
              name: 'p53 homologous superfamily',
              type: 'homologous_superfamily',
              source_database: 'interpro'
            },
            proteins: [
              {
                accession: 'P04637',
                protein_length: 393,
                entry_protein_locations: [{ fragments: [{ start: 1, end: 393 }] }]
              }
            ]
          }
        ]
      }

      nock('https://www.ebi.ac.uk')
        .get('/interpro/api/entry/interpro/protein/uniprot/P04637')
        .reply(200, mockWithSuperfamily)

      const result = await client.fetchDomains('P04637')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.domains).toHaveLength(1)
        expect(result.domains[0].type).toBe('domain')
        // homologous_superfamily should not appear
        const hasSuperfamily = result.domains.some((d) => d.type === 'homologous_superfamily')
        expect(hasSuperfamily).toBe(false)
      }
    })

    it('should handle API errors', async () => {
      nock('https://www.ebi.ac.uk')
        .get('/interpro/api/entry/interpro/protein/uniprot/P04637')
        .reply(500, { error: 'Internal server error' })

      const result = await client.fetchDomains('P04637')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('InterPro API error: 500')
        expect(result.offline).toBe(false)
      }
    })

    it('should handle network errors', async () => {
      nock('https://www.ebi.ac.uk')
        .get('/interpro/api/entry/interpro/protein/uniprot/P04637')
        .replyWithError('Network error')

      const result = await client.fetchDomains('P04637')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('Network error')
        expect(result.offline).toBe(false)
      }
    })

    it('should handle invalid response format', async () => {
      nock('https://www.ebi.ac.uk')
        .get('/interpro/api/entry/interpro/protein/uniprot/P04637')
        .reply(200, { invalid: 'format' })

      const result = await client.fetchDomains('P04637')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('Invalid InterPro response format')
      }
    })

    it('should return empty domains for entry with no proteins', async () => {
      const mockNoProteins = {
        count: 1,
        results: [
          {
            metadata: {
              accession: 'IPR011615',
              name: 'p53, DNA-binding domain',
              type: 'domain',
              source_database: 'interpro'
            }
            // no proteins field
          }
        ]
      }

      nock('https://www.ebi.ac.uk')
        .get('/interpro/api/entry/interpro/protein/uniprot/P04637')
        .reply(200, mockNoProteins)

      const result = await client.fetchDomains('P04637')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.domains).toHaveLength(0)
        expect(result.proteinLength).toBe(0)
      }
    })

    it('should return zero domains for empty results', async () => {
      nock('https://www.ebi.ac.uk')
        .get('/interpro/api/entry/interpro/protein/uniprot/P99999')
        .reply(200, { count: 0, results: [] })

      const result = await client.fetchDomains('P99999')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.domains).toHaveLength(0)
        expect(result.proteinLength).toBe(0)
      }
    })
  })

  describe('clearCache', () => {
    it('should clear all InterPro cache entries', () => {
      // Add InterPro cache entries
      cache.set('interpro:P04637', JSON.stringify(mockInterProResponse), 90)
      cache.set('interpro:P53350', JSON.stringify(mockInterProResponse), 90)

      // Add a VEP cache entry (should not be cleared)
      cache.set('vep:1:100:A:T', JSON.stringify([{ input: '1:100:A:T' }]), 30)

      client.clearCache()

      // InterPro entries should be gone
      expect(cache.get('interpro:P04637')).toBe(null)
      expect(cache.get('interpro:P53350')).toBe(null)

      // VEP entry should remain
      expect(cache.get('vep:1:100:A:T')).not.toBe(null)
    })
  })
})
