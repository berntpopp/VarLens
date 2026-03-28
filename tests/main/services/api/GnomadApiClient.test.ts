/**
 * Tests for GnomadApiClient
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import nock from 'nock'
import Database from 'better-sqlite3-multiple-ciphers'
import { tmpdir } from 'os'
import { join } from 'path'
import { unlinkSync } from 'fs'
import { ApiCache } from '../../../../src/main/services/api/ApiCache'
import { GnomadApiClient } from '../../../../src/main/services/api/GnomadApiClient'

describe('GnomadApiClient', () => {
  let db: Database.Database
  let cache: ApiCache
  let client: GnomadApiClient
  let tempDbPath: string

  const mockGnomadResponse = {
    data: {
      gene: {
        gene_id: 'ENSG00000141510',
        symbol: 'TP53',
        variants: [
          {
            variant_id: '17-7674220-C-T',
            pos: 7674220,
            ref: 'C',
            alt: 'T',
            exome: { ac: 5, an: 150000, af: 0.0000333 },
            genome: null,
            transcript_consequence: {
              major_consequence: 'missense_variant',
              hgvsp: 'p.Arg248Trp',
              hgvsc: 'c.742C>T'
            }
          },
          {
            variant_id: '17-7674230-G-A',
            pos: 7674230,
            ref: 'G',
            alt: 'A',
            exome: { ac: 0, an: 150000, af: 0 },
            genome: { ac: 1, an: 76000, af: 0.0000132 },
            transcript_consequence: {
              major_consequence: 'synonymous_variant',
              hgvsp: null,
              hgvsc: 'c.752G>A'
            }
          }
        ]
      }
    }
  }

  beforeEach(() => {
    tempDbPath = join(tmpdir(), `gnomad-test-${Date.now()}.db`)
    db = new Database(tempDbPath)

    db.exec(`
      CREATE TABLE api_cache (
        cache_key TEXT PRIMARY KEY,
        response_data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `)

    cache = new ApiCache(db)
    client = new GnomadApiClient(cache)

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

  describe('fetchGeneVariants', () => {
    it('should fetch and parse gnomAD variants for a gene', async () => {
      nock('https://gnomad.broadinstitute.org').post('/api').reply(200, mockGnomadResponse)

      const result = await client.fetchGeneVariants('TP53')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.geneId).toBe('ENSG00000141510')
        expect(result.dataset).toBe('gnomad_r4')
        expect(result.variants).toHaveLength(2)
        expect(result.cacheInfo.cached).toBe(false)
      }
    })

    it('should combine exome and genome allele frequency correctly', async () => {
      nock('https://gnomad.broadinstitute.org').post('/api').reply(200, mockGnomadResponse)

      const result = await client.fetchGeneVariants('TP53')

      expect(result.success).toBe(true)
      if (result.success) {
        // First variant: exome AF > 0, so use exome AF
        const missenseVariant = result.variants.find((v) => v.variantId === '17-7674220-C-T')
        expect(missenseVariant).toBeDefined()
        expect(missenseVariant?.alleleFrequency).toBe(0.0000333)
        expect(missenseVariant?.alleleCount).toBe(5) // exome ac=5 + genome null (0)
        expect(missenseVariant?.alleleNumber).toBe(150000) // max(150000, 0)

        // Second variant: exome AF = 0, so use genome AF
        const synonymousVariant = result.variants.find((v) => v.variantId === '17-7674230-G-A')
        expect(synonymousVariant).toBeDefined()
        expect(synonymousVariant?.alleleFrequency).toBe(0.0000132)
        expect(synonymousVariant?.alleleCount).toBe(1) // exome ac=0 + genome ac=1
        expect(synonymousVariant?.alleleNumber).toBe(150000) // max(150000, 76000)
      }
    })

    it('should return cached result on second call', async () => {
      nock('https://gnomad.broadinstitute.org').post('/api').reply(200, mockGnomadResponse)

      // First call — fetches from API
      const first = await client.fetchGeneVariants('TP53')
      expect(first.success).toBe(true)
      if (first.success) {
        expect(first.cacheInfo.cached).toBe(false)
      }

      // Second call — should be served from cache (no nock mock registered)
      const second = await client.fetchGeneVariants('TP53')
      expect(second.success).toBe(true)
      if (second.success) {
        expect(second.cacheInfo.cached).toBe(true)
        expect(second.cacheInfo.cachedAt).toBeTypeOf('number')
        expect(second.variants).toHaveLength(2)
      }

      // Verify no extra HTTP requests were made
      expect(nock.activeMocks()).toHaveLength(0)
    })

    it('should handle gene not found (null gene in response)', async () => {
      const notFoundResponse = { data: { gene: null } }

      nock('https://gnomad.broadinstitute.org').post('/api').reply(200, notFoundResponse)

      const result = await client.fetchGeneVariants('UNKNOWN_GENE')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('Gene not found in gnomAD: UNKNOWN_GENE')
      }
    })

    it('should parse protein position from hgvsp', async () => {
      nock('https://gnomad.broadinstitute.org').post('/api').reply(200, mockGnomadResponse)

      const result = await client.fetchGeneVariants('TP53')

      expect(result.success).toBe(true)
      if (result.success) {
        // Missense variant with hgvsp p.Arg248Trp → position 248
        const missenseVariant = result.variants.find((v) => v.variantId === '17-7674220-C-T')
        expect(missenseVariant?.proteinPosition).toBe(248)
        expect(missenseVariant?.hgvsp).toBe('p.Arg248Trp')

        // Synonymous variant with null hgvsp → null position
        const synonymousVariant = result.variants.find((v) => v.variantId === '17-7674230-G-A')
        expect(synonymousVariant?.proteinPosition).toBe(null)
        expect(synonymousVariant?.hgvsp).toBe(null)
      }
    })

    it('should handle network errors', async () => {
      nock('https://gnomad.broadinstitute.org').post('/api').replyWithError('Network error')

      const result = await client.fetchGeneVariants('TP53')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('Network error')
      }
    })

    it('should handle API error responses', async () => {
      nock('https://gnomad.broadinstitute.org')
        .post('/api')
        .reply(500, { error: 'Internal server error' })

      const result = await client.fetchGeneVariants('TP53')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('gnomAD API error: 500')
      }
    })

    it('should handle invalid response format', async () => {
      nock('https://gnomad.broadinstitute.org').post('/api').reply(200, { unexpected: 'format' })

      const result = await client.fetchGeneVariants('TP53')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('Invalid gnomAD response format')
      }
    })

    it('should return cached gene-not-found result', async () => {
      // Pre-populate cache with a null-gene response
      const notFoundResponse = { data: { gene: null } }
      const cacheKey = 'gnomad:BRCA2:GRCh38:gnomad_r4'
      cache.set(cacheKey, JSON.stringify(notFoundResponse), 30)

      const result = await client.fetchGeneVariants('BRCA2')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('Gene not found in gnomAD: BRCA2')
      }
    })
  })

  describe('clearCache', () => {
    it('should clear all gnomAD cache entries', async () => {
      // Pre-populate cache
      const cacheKey = 'gnomad:TP53:GRCh38:gnomad_r4'
      cache.set(cacheKey, JSON.stringify(mockGnomadResponse), 30)

      // Add a VEP entry that should NOT be cleared
      cache.set('vep:17:7674220:C:T', JSON.stringify([]), 30)

      client.clearCache()

      expect(cache.get(cacheKey)).toBe(null)
      expect(cache.get('vep:17:7674220:C:T')).not.toBe(null)
    })
  })
})
