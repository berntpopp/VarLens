/**
 * Tests for UniProtApiClient
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import nock from 'nock'
import Database from 'better-sqlite3-multiple-ciphers'
import { tmpdir } from 'os'
import { join } from 'path'
import { unlinkSync } from 'fs'
import { ApiCache } from '../../../../src/main/services/api/ApiCache'
import { UniProtApiClient } from '../../../../src/main/services/api/UniProtApiClient'

describe('UniProtApiClient', () => {
  let db: Database.Database
  let cache: ApiCache
  let client: UniProtApiClient
  let tempDbPath: string

  // Sample UniProt response matching actual API structure
  const mockUniProtResponse = {
    results: [
      {
        primaryAccession: 'P38398',
        uniProtkbId: 'BRCA1_HUMAN',
        genes: [
          {
            geneName: { value: 'BRCA1' }
          }
        ],
        proteinDescription: {
          recommendedName: {
            fullName: { value: 'Breast cancer type 1 susceptibility protein' }
          }
        },
        sequence: { length: 1863 }
      }
    ]
  }

  beforeEach(() => {
    // Create temp database for each test
    tempDbPath = join(tmpdir(), `uniprot-test-${Date.now()}.db`)
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
    client = new UniProtApiClient(cache)

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

  describe('fetchProteinMapping', () => {
    it('should fetch and parse UniProt mapping for a gene symbol', async () => {
      nock('https://rest.uniprot.org')
        .get(
          '/uniprotkb/search?query=gene_exact:BRCA1+AND+organism_id:9606+AND+reviewed:true&fields=accession,gene_names,protein_name,length&format=json&size=1'
        )
        .reply(200, mockUniProtResponse)

      const result = await client.fetchProteinMapping('BRCA1')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.mapping.uniprotAccession).toBe('P38398')
        expect(result.mapping.geneName).toBe('BRCA1')
        expect(result.mapping.proteinName).toBe('Breast cancer type 1 susceptibility protein')
        expect(result.mapping.proteinLength).toBe(1863)
        expect(result.cacheInfo.cached).toBe(false)
      }
    })

    it('should return cached result on second call without hitting API', async () => {
      // Only register one HTTP mock — if called twice nock would throw
      nock('https://rest.uniprot.org')
        .get(
          '/uniprotkb/search?query=gene_exact:BRCA1+AND+organism_id:9606+AND+reviewed:true&fields=accession,gene_names,protein_name,length&format=json&size=1'
        )
        .reply(200, mockUniProtResponse)

      // First call — populates cache
      await client.fetchProteinMapping('BRCA1')

      // Second call — should use cache
      const result = await client.fetchProteinMapping('BRCA1')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.mapping.uniprotAccession).toBe('P38398')
        expect(result.cacheInfo.cached).toBe(true)
        expect(result.cacheInfo.cachedAt).toBeTypeOf('number')
      }

      // nock mock must have been consumed exactly once
      expect(nock.activeMocks()).toHaveLength(0)
    })

    it('should return error for gene with no UniProt match (empty results)', async () => {
      nock('https://rest.uniprot.org')
        .get(
          '/uniprotkb/search?query=gene_exact:UNKNOWN_GENE_XYZ+AND+organism_id:9606+AND+reviewed:true&fields=accession,gene_names,protein_name,length&format=json&size=1'
        )
        .reply(200, { results: [] })

      const result = await client.fetchProteinMapping('UNKNOWN_GENE_XYZ')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('No UniProt entry found')
      }
    })

    it('should return error on network failure', async () => {
      nock('https://rest.uniprot.org')
        .get(
          '/uniprotkb/search?query=gene_exact:BRCA1+AND+organism_id:9606+AND+reviewed:true&fields=accession,gene_names,protein_name,length&format=json&size=1'
        )
        .replyWithError('Network error')

      const result = await client.fetchProteinMapping('BRCA1')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('Network error')
        expect(result.offline).toBe(false)
      }
    })

    it('should handle API error responses', async () => {
      nock('https://rest.uniprot.org')
        .get(
          '/uniprotkb/search?query=gene_exact:BRCA1+AND+organism_id:9606+AND+reviewed:true&fields=accession,gene_names,protein_name,length&format=json&size=1'
        )
        .reply(500, { messages: ['Internal server error'] })

      const result = await client.fetchProteinMapping('BRCA1')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('UniProt API error: 500')
      }
    })

    it('should handle invalid response format', async () => {
      nock('https://rest.uniprot.org')
        .get(
          '/uniprotkb/search?query=gene_exact:BRCA1+AND+organism_id:9606+AND+reviewed:true&fields=accession,gene_names,protein_name,length&format=json&size=1'
        )
        .reply(200, { invalid: 'format' })

      const result = await client.fetchProteinMapping('BRCA1')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('Invalid UniProt response format')
      }
    })
  })

  describe('clearCache', () => {
    it('should clear all UniProt cache entries', () => {
      // Add UniProt cache entries
      cache.set('uniprot:BRCA1', JSON.stringify(mockUniProtResponse), 90)
      cache.set('uniprot:TP53', JSON.stringify(mockUniProtResponse), 90)

      // Add a VEP cache entry (should not be cleared)
      cache.set('vep:1:100:A:T', JSON.stringify([]), 30)

      client.clearCache()

      // UniProt entries should be gone
      expect(cache.get('uniprot:BRCA1')).toBe(null)
      expect(cache.get('uniprot:TP53')).toBe(null)

      // VEP entry should remain
      expect(cache.get('vep:1:100:A:T')).not.toBe(null)
    })
  })
})
