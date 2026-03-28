/**
 * Tests for AlphaFoldApiClient
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import nock from 'nock'
import Database from 'better-sqlite3-multiple-ciphers'
import { tmpdir } from 'os'
import { join } from 'path'
import { unlinkSync } from 'fs'
import { ApiCache } from '../../../../src/main/services/api/ApiCache'
import { AlphaFoldApiClient } from '../../../../src/main/services/api/AlphaFoldApiClient'

describe('AlphaFoldApiClient', () => {
  let db: Database.Database
  let cache: ApiCache
  let client: AlphaFoldApiClient
  let tempDbPath: string

  const mockAlphaFoldResponse = [
    {
      entryId: 'AF-P04637-F1',
      uniprotAccession: 'P04637',
      uniprotId: 'P53_HUMAN',
      uniprotDescription: 'Cellular tumor antigen p53',
      modelUrl: 'https://alphafold.ebi.ac.uk/files/AF-P04637-F1-model_v4.cif',
      cifUrl: 'https://alphafold.ebi.ac.uk/files/AF-P04637-F1-model_v4.cif',
      bcifUrl: 'https://alphafold.ebi.ac.uk/files/AF-P04637-F1-model_v4.bcif',
      pdbUrl: 'https://alphafold.ebi.ac.uk/files/AF-P04637-F1-model_v4.pdb',
      paeImageUrl: 'https://alphafold.ebi.ac.uk/files/AF-P04637-F1-predicted_aligned_error_v4.png',
      modelCreatedDate: '2022-06-01',
      latestVersion: 4
    }
  ]

  beforeEach(() => {
    // Create temp database for each test
    tempDbPath = join(tmpdir(), `alphafold-test-${Date.now()}.db`)
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
    client = new AlphaFoldApiClient(cache)

    // Enable nock for HTTP mocking
    nock.disableNetConnect()
  })

  afterEach(() => {
    db.close()
    try {
      unlinkSync(tempDbPath)
    } catch {
      // Ignore if file doesn't exist
    }
    nock.cleanAll()
    nock.enableNetConnect()
  })

  describe('fetchStructure', () => {
    it('should fetch structure info for a UniProt accession', async () => {
      nock('https://alphafold.ebi.ac.uk')
        .get('/api/prediction/P04637')
        .reply(200, mockAlphaFoldResponse)

      const result = await client.fetchStructure('P04637')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.structure.uniprotAccession).toBe('P04637')
        // AlphaFold CIF structure
        expect(result.structure.alphafold).not.toBe(null)
        expect(result.structure.alphafold?.source).toBe('alphafold')
        expect(result.structure.alphafold?.format).toBe('cif')
        expect(result.structure.alphafold?.id).toBe('AF-P04637-F1')
        expect(result.structure.alphafold?.url).toBe(
          'https://alphafold.ebi.ac.uk/files/AF-P04637-F1-model_v4.cif'
        )
        expect(result.structure.alphafold?.version).toBe(4)
        // PDB structure
        expect(result.structure.pdb).not.toBe(null)
        expect(result.structure.pdb?.source).toBe('pdb')
        expect(result.structure.pdb?.format).toBe('pdb')
        expect(result.structure.pdb?.id).toBe('AF-P04637-F1')
        expect(result.structure.pdb?.url).toBe(
          'https://alphafold.ebi.ac.uk/files/AF-P04637-F1-model_v4.pdb'
        )
        // Cache info: first fetch is not cached
        expect(result.cacheInfo.cached).toBe(false)
      }
    })

    it('should return cached result on second call', async () => {
      nock('https://alphafold.ebi.ac.uk')
        .get('/api/prediction/P04637')
        .reply(200, mockAlphaFoldResponse)

      // First call hits the network
      await client.fetchStructure('P04637')

      // No further nock mocks registered — second call must use cache
      const result = await client.fetchStructure('P04637')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.cacheInfo.cached).toBe(true)
        expect(result.cacheInfo.cachedAt).toBeTypeOf('number')
        expect(result.structure.alphafold?.id).toBe('AF-P04637-F1')
      }

      // Verify no additional HTTP requests were made
      expect(nock.activeMocks()).toHaveLength(0)
    })

    it('should return null alphafold when no prediction exists (404)', async () => {
      nock('https://alphafold.ebi.ac.uk').get('/api/prediction/Q99999').reply(404)

      const result = await client.fetchStructure('Q99999')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.structure.uniprotAccession).toBe('Q99999')
        expect(result.structure.alphafold).toBe(null)
        expect(result.structure.pdb).toBe(null)
        expect(result.cacheInfo.cached).toBe(false)
      }
    })

    it('should cache the empty result after a 404', async () => {
      nock('https://alphafold.ebi.ac.uk').get('/api/prediction/Q99999').reply(404)

      // First call populates cache with empty array
      await client.fetchStructure('Q99999')

      // Second call should not make a network request
      const result = await client.fetchStructure('Q99999')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.structure.alphafold).toBe(null)
        expect(result.cacheInfo.cached).toBe(true)
      }

      expect(nock.activeMocks()).toHaveLength(0)
    })

    it('should handle network errors', async () => {
      nock('https://alphafold.ebi.ac.uk')
        .get('/api/prediction/P04637')
        .replyWithError('Network error')

      const result = await client.fetchStructure('P04637')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('Network error')
        expect(result.offline).toBe(false)
      }
    })

    it('should handle non-OK API responses', async () => {
      nock('https://alphafold.ebi.ac.uk')
        .get('/api/prediction/P04637')
        .reply(500, { error: 'Internal server error' })

      const result = await client.fetchStructure('P04637')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('AlphaFold API error: 500')
      }
    })

    it('should handle invalid response format', async () => {
      nock('https://alphafold.ebi.ac.uk')
        .get('/api/prediction/P04637')
        .reply(200, { invalid: 'format' })

      const result = await client.fetchStructure('P04637')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('Invalid AlphaFold response format')
      }
    })
  })

  describe('clearCache', () => {
    it('should clear all AlphaFold cache entries', async () => {
      // Pre-populate cache
      cache.set('alphafold:P04637', JSON.stringify(mockAlphaFoldResponse), 90)
      cache.set('alphafold:TP53', JSON.stringify(mockAlphaFoldResponse), 90)
      // Unrelated entry that should survive
      cache.set('uniprot:BRCA1', JSON.stringify({ results: [] }), 30)

      client.clearCache()

      expect(cache.get('alphafold:P04637')).toBe(null)
      expect(cache.get('alphafold:TP53')).toBe(null)
      expect(cache.get('uniprot:BRCA1')).not.toBe(null)
    })
  })
})
