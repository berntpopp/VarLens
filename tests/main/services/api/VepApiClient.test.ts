/**
 * Tests for VepApiClient
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import nock from 'nock'
import Database from 'better-sqlite3-multiple-ciphers'
import { tmpdir } from 'os'
import { join } from 'path'
import { unlinkSync } from 'fs'
import { ApiCache } from '../../../../src/main/services/api/ApiCache'
import { VepApiClient, normalizeChromosome } from '../../../../src/main/services/api/VepApiClient'

describe('VepApiClient', () => {
  let db: Database.Database
  let cache: ApiCache
  let client: VepApiClient
  let tempDbPath: string

  // Sample VEP response matching actual API structure
  const mockVepResponse = [
    {
      input: '1:100:A:T',
      most_severe_consequence: 'missense_variant',
      transcript_consequences: [
        {
          transcript_id: 'ENST00000123456',
          gene_symbol: 'BRCA1',
          consequence_terms: ['missense_variant'],
          impact: 'MODERATE' as const,
          mane_select: 'ENST00000123456.7',
          canonical: 1,
          biotype: 'protein_coding',
          cadd_phred: 25.3,
          revel_score: 0.75,
          sift_prediction: 'deleterious',
          polyphen_prediction: 'probably_damaging',
          spliceai_pred_ds_ag: 0.01,
          spliceai_pred_ds_al: 0.02,
          spliceai_pred_ds_dg: 0.15,
          spliceai_pred_ds_dl: 0.03,
          gnomad_af: 0.0001
        }
      ]
    }
  ]

  beforeEach(() => {
    // Create temp database for each test
    tempDbPath = join(tmpdir(), `vep-test-${Date.now()}.db`)
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
    client = new VepApiClient(cache)

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

  describe('normalizeChromosome', () => {
    it('should remove chr prefix', () => {
      expect(normalizeChromosome('chr1')).toBe('1')
      expect(normalizeChromosome('chrX')).toBe('X')
      expect(normalizeChromosome('chr22')).toBe('22')
    })

    it('should handle chromosomes without prefix', () => {
      expect(normalizeChromosome('1')).toBe('1')
      expect(normalizeChromosome('X')).toBe('X')
      expect(normalizeChromosome('Y')).toBe('Y')
    })

    it('should standardize mitochondrial chromosome', () => {
      expect(normalizeChromosome('chrM')).toBe('MT')
      expect(normalizeChromosome('chrMT')).toBe('MT')
      expect(normalizeChromosome('M')).toBe('MT')
      expect(normalizeChromosome('mt')).toBe('MT')
      expect(normalizeChromosome('MT')).toBe('MT')
    })

    it('should be case insensitive for chr prefix', () => {
      expect(normalizeChromosome('CHR1')).toBe('1')
      expect(normalizeChromosome('Chr1')).toBe('1')
    })
  })

  describe('fetchVariantAnnotation', () => {
    it('should fetch and validate VEP response', async () => {
      nock('https://rest.ensembl.org')
        .get('/vep/human/region/1:100:100/T?content-type=application/json&CADD=1&sift=b&polyphen=b')
        .reply(200, mockVepResponse)

      const result = await client.fetchVariantAnnotation('1', 100, 'A', 'T')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toHaveLength(1)
        expect(result.data[0].input).toBe('1:100:A:T')
        expect(result.cacheInfo.cached).toBe(false)
        expect(result.cacheInfo.cachedAt).toBe(null)
        // Verify transcript selection
        expect(result.preferredTranscript).not.toBe(null)
        expect(result.preferredTranscript?.transcript_id).toBe('ENST00000123456')
        expect(result.allTranscripts).toHaveLength(1)
      }
    })

    it('should normalize chromosome in cache key', async () => {
      nock('https://rest.ensembl.org')
        .get('/vep/human/region/1:100:100/T?content-type=application/json&CADD=1&sift=b&polyphen=b')
        .reply(200, mockVepResponse)

      await client.fetchVariantAnnotation('chr1', 100, 'A', 'T')

      // Check that cache key was normalized (chr prefix removed)
      const cached = cache.get('vep:1:100:A:T')
      expect(cached).not.toBe(null)
    })

    it('should return cached data when available', async () => {
      // Pre-populate cache
      const cacheKey = 'vep:1:100:A:T'
      cache.set(cacheKey, JSON.stringify(mockVepResponse), 30)

      // Should not make HTTP request - don't register any nock mocks
      const result = await client.fetchVariantAnnotation('1', 100, 'A', 'T')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toHaveLength(1)
        expect(result.cacheInfo.cached).toBe(true)
        expect(result.cacheInfo.cachedAt).toBeTypeOf('number')
        // Verify transcript selection works from cache
        expect(result.preferredTranscript).not.toBe(null)
        expect(result.allTranscripts).toHaveLength(1)
      }

      // Verify no HTTP requests were made (no pending nock mocks)
      expect(nock.activeMocks()).toHaveLength(0)
    })

    it('should handle 429 rate limit response', async () => {
      // Mock 429 response followed by success
      nock('https://rest.ensembl.org')
        .get('/vep/human/region/1:100:100/T?content-type=application/json&CADD=1&sift=b&polyphen=b')
        .reply(429, { error: 'Rate limit exceeded' }, { 'Retry-After': '1' })
        .get('/vep/human/region/1:100:100/T?content-type=application/json&CADD=1&sift=b&polyphen=b')
        .reply(200, mockVepResponse)

      // Should retry after backoff
      const result = await client.fetchVariantAnnotation('1', 100, 'A', 'T')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toHaveLength(1)
      }
    }, 10000) // Increase timeout for retry delays

    it('should handle network errors', async () => {
      nock('https://rest.ensembl.org')
        .get('/vep/human/region/1:100:100/T?content-type=application/json&CADD=1&sift=b&polyphen=b')
        .replyWithError('Network error')

      const result = await client.fetchVariantAnnotation('1', 100, 'A', 'T')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('Network error')
        expect(result.offline).toBe(false)
      }
    })

    it('should handle invalid response format', async () => {
      nock('https://rest.ensembl.org')
        .get('/vep/human/region/1:100:100/T?content-type=application/json&CADD=1&sift=b&polyphen=b')
        .reply(200, { invalid: 'format' })

      const result = await client.fetchVariantAnnotation('1', 100, 'A', 'T')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('Invalid VEP response format')
      }
    })

    it('should handle API error responses', async () => {
      nock('https://rest.ensembl.org')
        .get('/vep/human/region/1:100:100/T?content-type=application/json&CADD=1&sift=b&polyphen=b')
        .reply(500, { error: 'Internal server error' })

      const result = await client.fetchVariantAnnotation('1', 100, 'A', 'T')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('VEP API error: 500')
      }
    })
  })

  describe('cancelPendingRequest', () => {
    it('should abort in-flight request', async () => {
      // Mock slow response
      nock('https://rest.ensembl.org')
        .get('/vep/human/region/1:100:100/T?content-type=application/json&CADD=1&sift=b&polyphen=b')
        .delay(1000)
        .reply(200, mockVepResponse)

      // Start request
      const promise = client.fetchVariantAnnotation('1', 100, 'A', 'T')

      // Cancel after 100ms
      setTimeout(() => client.cancelPendingRequest(), 100)

      // Should throw AbortError
      await expect(promise).rejects.toThrow('abort')
    })
  })

  describe('getCached', () => {
    it('should return cached response when available', () => {
      const cacheKey = 'vep:1:100:A:T'
      cache.set(cacheKey, JSON.stringify(mockVepResponse), 30)

      const result = client.getCached(cacheKey)

      expect(result).not.toBe(null)
      if (result) {
        expect(result.data).toHaveLength(1)
        expect(result.createdAt).toBeTypeOf('number')
      }
    })

    it('should return null when not cached', () => {
      const result = client.getCached('vep:1:100:A:T')
      expect(result).toBe(null)
    })

    it('should return null for corrupted cache entry', () => {
      const cacheKey = 'vep:1:100:A:T'
      cache.set(cacheKey, 'invalid json', 30)

      const result = client.getCached(cacheKey)
      expect(result).toBe(null)
    })
  })

  describe('selectPreferredTranscript', () => {
    it('should return MANE Select transcript when present', () => {
      const response = [
        {
          input: '1:100:A:T',
          transcript_consequences: [
            {
              transcript_id: 'ENST00000111111',
              gene_symbol: 'GENE1',
              consequence_terms: ['missense_variant'],
              canonical: 1
            },
            {
              transcript_id: 'ENST00000222222',
              gene_symbol: 'GENE1',
              consequence_terms: ['missense_variant'],
              mane_select: 'ENST00000222222.7'
            }
          ]
        }
      ]

      const preferred = client.selectPreferredTranscript(response)

      expect(preferred).not.toBe(null)
      expect(preferred?.transcript_id).toBe('ENST00000222222')
      expect(preferred?.mane_select).toBe('ENST00000222222.7')
    })

    it('should fall back to canonical when no MANE Select', () => {
      const response = [
        {
          input: '1:100:A:T',
          transcript_consequences: [
            {
              transcript_id: 'ENST00000111111',
              gene_symbol: 'GENE1',
              consequence_terms: ['missense_variant']
            },
            {
              transcript_id: 'ENST00000222222',
              gene_symbol: 'GENE1',
              consequence_terms: ['missense_variant'],
              canonical: 1
            }
          ]
        }
      ]

      const preferred = client.selectPreferredTranscript(response)

      expect(preferred).not.toBe(null)
      expect(preferred?.transcript_id).toBe('ENST00000222222')
      expect(preferred?.canonical).toBe(1)
    })

    it('should return first transcript when neither MANE nor canonical', () => {
      const response = [
        {
          input: '1:100:A:T',
          transcript_consequences: [
            {
              transcript_id: 'ENST00000111111',
              gene_symbol: 'GENE1',
              consequence_terms: ['missense_variant']
            },
            {
              transcript_id: 'ENST00000222222',
              gene_symbol: 'GENE1',
              consequence_terms: ['missense_variant']
            }
          ]
        }
      ]

      const preferred = client.selectPreferredTranscript(response)

      expect(preferred).not.toBe(null)
      expect(preferred?.transcript_id).toBe('ENST00000111111')
    })

    it('should return null when no transcripts available', () => {
      const response = [
        {
          input: '1:100:A:T',
          transcript_consequences: []
        }
      ]

      const preferred = client.selectPreferredTranscript(response)
      expect(preferred).toBe(null)
    })
  })

  describe('getAllTranscripts', () => {
    it('should return all transcripts from response', () => {
      const response = [
        {
          input: '1:100:A:T',
          transcript_consequences: [
            {
              transcript_id: 'ENST00000111111',
              gene_symbol: 'GENE1',
              consequence_terms: ['missense_variant']
            },
            {
              transcript_id: 'ENST00000222222',
              gene_symbol: 'GENE1',
              consequence_terms: ['missense_variant']
            }
          ]
        }
      ]

      const transcripts = client.getAllTranscripts(response)

      expect(transcripts).toHaveLength(2)
      expect(transcripts[0].transcript_id).toBe('ENST00000111111')
      expect(transcripts[1].transcript_id).toBe('ENST00000222222')
    })

    it('should return empty array when no transcripts', () => {
      const response = [
        {
          input: '1:100:A:T'
        }
      ]

      const transcripts = client.getAllTranscripts(response)
      expect(transcripts).toEqual([])
    })
  })

  describe('extractScores', () => {
    it('should extract all available scores', () => {
      const transcript = {
        transcript_id: 'ENST00000123456',
        gene_symbol: 'BRCA1',
        consequence_terms: ['missense_variant'],
        cadd_phred: 25.3,
        revel_score: 0.75,
        sift_prediction: 'deleterious',
        polyphen_prediction: 'probably_damaging',
        spliceai_pred_ds_ag: 0.01,
        spliceai_pred_ds_al: 0.02,
        spliceai_pred_ds_dg: 0.15,
        spliceai_pred_ds_dl: 0.03,
        gnomad_af: 0.0001
      }

      const scores = client.extractScores(transcript)

      expect(scores.cadd_phred).toBe(25.3)
      expect(scores.revel_score).toBe(0.75)
      expect(scores.sift_prediction).toBe('deleterious')
      expect(scores.polyphen_prediction).toBe('probably_damaging')
      expect(scores.gnomad_af).toBe(0.0001)
      // SpliceAI max delta should be 0.15 (max of 0.01, 0.02, 0.15, 0.03)
      expect(scores.spliceai_max_delta).toBe(0.15)
    })

    it('should handle missing scores', () => {
      const transcript = {
        transcript_id: 'ENST00000123456',
        gene_symbol: 'BRCA1',
        consequence_terms: ['missense_variant']
      }

      const scores = client.extractScores(transcript)

      expect(scores.cadd_phred).toBe(undefined)
      expect(scores.revel_score).toBe(undefined)
      expect(scores.sift_prediction).toBe(undefined)
      expect(scores.polyphen_prediction).toBe(undefined)
      expect(scores.gnomad_af).toBe(undefined)
      expect(scores.spliceai_max_delta).toBe(undefined)
    })

    it('should calculate SpliceAI max delta correctly', () => {
      const transcript = {
        transcript_id: 'ENST00000123456',
        gene_symbol: 'BRCA1',
        consequence_terms: ['splice_region_variant'],
        spliceai_pred_ds_ag: 0.8,
        spliceai_pred_ds_al: 0.1,
        spliceai_pred_ds_dg: 0.3,
        spliceai_pred_ds_dl: 0.05
      }

      const scores = client.extractScores(transcript)

      // Should be max of all 4 delta scores
      expect(scores.spliceai_max_delta).toBe(0.8)
    })
  })

  describe('clearCache', () => {
    it('should clear all VEP cache entries', () => {
      // Add VEP cache entries
      cache.set('vep:1:100:A:T', JSON.stringify(mockVepResponse), 30)
      cache.set('vep:2:200:C:G', JSON.stringify(mockVepResponse), 30)

      // Add HPO cache entry (should not be cleared)
      cache.set('hpo:test', JSON.stringify({ terms: [] }), 30)

      client.clearCache()

      // VEP entries should be gone
      expect(cache.get('vep:1:100:A:T')).toBe(null)
      expect(cache.get('vep:2:200:C:G')).toBe(null)

      // HPO entry should remain
      expect(cache.get('hpo:test')).not.toBe(null)
    })
  })
})
