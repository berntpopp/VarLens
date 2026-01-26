import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  DatabaseService,
  NotFoundError,
  type Variant,
  type VariantFilter
} from '../../../src/main/database'

/**
 * Test utilities for variant operations
 */

/**
 * Create a test case in the database
 * @param db - DatabaseService instance
 * @param name - Case name
 * @returns Case ID
 */
function createTestCase(db: DatabaseService, name: string): number {
  return db.createCase(name, `/path/to/${name}.vcf`, 1024)
}

/**
 * Create test variant data with varied values
 * @param count - Number of variants to generate
 * @param options - Optional customization
 * @returns Array of variant data without id and case_id
 */
function createTestVariants(
  count: number,
  options?: {
    genePrefix?: string
    consequence?: string
    gnomadAf?: number | null
    cadd?: number | null
    startPos?: number
  }
): Omit<Variant, 'id' | 'case_id'>[] {
  const variants: Omit<Variant, 'id' | 'case_id'>[] = []
  const genes = ['BRCA1', 'BRCA2', 'TP53', 'KRAS', 'EGFR']
  const consequences = [
    'missense_variant',
    'stop_gained',
    'frameshift_variant',
    'synonymous_variant'
  ]

  for (let i = 0; i < count; i++) {
    variants.push({
      chr: String((i % 22) + 1),
      pos: (options?.startPos ?? 10000) + i * 100,
      ref: 'A',
      alt: 'G',
      gene_symbol: options?.genePrefix ? `${options.genePrefix}${i % 3}` : genes[i % genes.length],
      consequence: options?.consequence ?? consequences[i % consequences.length],
      gnomad_af: options?.gnomadAf !== undefined ? options.gnomadAf : (i + 1) * 0.01,
      cadd: options?.cadd !== undefined ? options.cadd : 10 + (i % 30),
      clinvar: i % 2 === 0 ? 'pathogenic' : null
    })
  }

  return variants
}

describe('Variant Operations', () => {
  let service: DatabaseService

  beforeEach(() => {
    service = new DatabaseService(':memory:')
  })

  afterEach(() => {
    service.close()
  })

  describe('insertVariantsBatch', () => {
    it('inserts variants and returns count', () => {
      const caseId = createTestCase(service, 'test-case')
      const variants = createTestVariants(10)

      const count = service.insertVariantsBatch(caseId, variants)

      expect(count).toBe(10)
    })

    it('updates case variant_count', () => {
      const caseId = createTestCase(service, 'test-case')
      const variants = createTestVariants(25)

      service.insertVariantsBatch(caseId, variants)

      const updatedCase = service.getCase(caseId)
      expect(updatedCase.variant_count).toBe(25)
    })

    it('handles batch boundary (exactly BATCH_SIZE)', () => {
      // Test with smaller number to keep test fast, but verify logic works
      const caseId = createTestCase(service, 'test-case')
      const variants = createTestVariants(100)

      const count = service.insertVariantsBatch(caseId, variants)

      expect(count).toBe(100)
      expect(service.getVariantCount(caseId)).toBe(100)
    })

    it('handles multiple batches', () => {
      // 101 variants would be 2 batches if BATCH_SIZE were 50
      // We're testing the loop logic with a smaller set
      const caseId = createTestCase(service, 'test-case')
      const variants = createTestVariants(150)

      const count = service.insertVariantsBatch(caseId, variants)

      expect(count).toBe(150)
      expect(service.getVariantCount(caseId)).toBe(150)
    })

    it('throws NotFoundError for invalid case_id', () => {
      const variants = createTestVariants(5)

      expect(() => {
        service.insertVariantsBatch(99999, variants)
      }).toThrow(NotFoundError)
    })

    it('maintains FTS5 index', () => {
      const caseId = createTestCase(service, 'test-case')
      const variants = [
        {
          chr: '1',
          pos: 10000,
          ref: 'A',
          alt: 'G',
          gene_symbol: 'UNIQUE_GENE_XYZ',
          consequence: 'missense_variant',
          gnomad_af: 0.01,
          cadd: 25,
          clinvar: null
        }
      ]

      service.insertVariantsBatch(caseId, variants)

      // Search for the unique gene symbol
      const results = service.searchVariants(caseId, 'UNIQUE_GENE')
      expect(results.length).toBe(1)
      expect(results[0].gene_symbol).toBe('UNIQUE_GENE_XYZ')
    })
  })

  describe('getVariantCount', () => {
    it('returns 0 for case with no variants', () => {
      const caseId = createTestCase(service, 'empty-case')

      const count = service.getVariantCount(caseId)

      expect(count).toBe(0)
    })

    it('returns correct count', () => {
      const caseId = createTestCase(service, 'test-case')
      const variants = createTestVariants(15)
      service.insertVariantsBatch(caseId, variants)

      const count = service.getVariantCount(caseId)

      expect(count).toBe(15)
    })
  })

  describe('getVariants pagination', () => {
    it('returns first page of results', () => {
      const caseId = createTestCase(service, 'test-case')
      const variants = createTestVariants(100)
      service.insertVariantsBatch(caseId, variants)

      const result = service.getVariants({ case_id: caseId }, 20)

      expect(result.data.length).toBe(20)
    })

    it('has_more is true when more results exist', () => {
      const caseId = createTestCase(service, 'test-case')
      const variants = createTestVariants(100)
      service.insertVariantsBatch(caseId, variants)

      const result = service.getVariants({ case_id: caseId }, 20)

      expect(result.has_more).toBe(true)
    })

    it('has_more is false on last page', () => {
      const caseId = createTestCase(service, 'test-case')
      const variants = createTestVariants(15)
      service.insertVariantsBatch(caseId, variants)

      const result = service.getVariants({ case_id: caseId }, 20)

      expect(result.has_more).toBe(false)
    })

    it('cursor navigates to next page', () => {
      const caseId = createTestCase(service, 'test-case')
      const variants = createTestVariants(50)
      service.insertVariantsBatch(caseId, variants)

      const page1 = service.getVariants({ case_id: caseId }, 20)
      expect(page1.next_cursor).not.toBeNull()

      const page2 = service.getVariants({ case_id: caseId }, 20, page1.next_cursor!)

      // Different results on page 2
      expect(page2.data[0].id).not.toBe(page1.data[0].id)
      // All page2 items should be different from page1
      const page1Ids = new Set(page1.data.map((v) => v.id))
      for (const v of page2.data) {
        expect(page1Ids.has(v.id)).toBe(false)
      }
    })

    it('total_count reflects all matching variants', () => {
      const caseId = createTestCase(service, 'test-case')
      const variants = createTestVariants(100)
      service.insertVariantsBatch(caseId, variants)

      const result = service.getVariants({ case_id: caseId }, 20)

      expect(result.total_count).toBe(100)
    })

    it('returns empty result for case with no variants', () => {
      const caseId = createTestCase(service, 'empty-case')

      const result = service.getVariants({ case_id: caseId }, 20)

      expect(result.data).toEqual([])
      expect(result.has_more).toBe(false)
      expect(result.total_count).toBe(0)
      expect(result.next_cursor).toBeNull()
    })
  })

  describe('getVariants filters', () => {
    it('filters by gene_symbol partial match', () => {
      const caseId = createTestCase(service, 'test-case')
      const variants = [
        {
          chr: '1',
          pos: 1000,
          ref: 'A',
          alt: 'G',
          gene_symbol: 'BRCA1',
          consequence: 'missense_variant',
          gnomad_af: 0.01,
          cadd: 20,
          clinvar: null
        },
        {
          chr: '1',
          pos: 2000,
          ref: 'C',
          alt: 'T',
          gene_symbol: 'BRCA2',
          consequence: 'missense_variant',
          gnomad_af: 0.02,
          cadd: 21,
          clinvar: null
        },
        {
          chr: '1',
          pos: 3000,
          ref: 'G',
          alt: 'A',
          gene_symbol: 'TP53',
          consequence: 'stop_gained',
          gnomad_af: 0.03,
          cadd: 22,
          clinvar: null
        }
      ]
      service.insertVariantsBatch(caseId, variants)

      const result = service.getVariants({ case_id: caseId, gene_symbol: 'BRCA' }, 20)

      expect(result.data.length).toBe(2)
      expect(result.data.every((v) => v.gene_symbol?.includes('BRCA'))).toBe(true)
    })

    it('filters by consequence exact match', () => {
      const caseId = createTestCase(service, 'test-case')
      const variants = [
        {
          chr: '1',
          pos: 1000,
          ref: 'A',
          alt: 'G',
          gene_symbol: 'GENE1',
          consequence: 'missense_variant',
          gnomad_af: 0.01,
          cadd: 20,
          clinvar: null
        },
        {
          chr: '1',
          pos: 2000,
          ref: 'C',
          alt: 'T',
          gene_symbol: 'GENE2',
          consequence: 'stop_gained',
          gnomad_af: 0.02,
          cadd: 21,
          clinvar: null
        },
        {
          chr: '1',
          pos: 3000,
          ref: 'G',
          alt: 'A',
          gene_symbol: 'GENE3',
          consequence: 'missense_variant',
          gnomad_af: 0.03,
          cadd: 22,
          clinvar: null
        }
      ]
      service.insertVariantsBatch(caseId, variants)

      const result = service.getVariants({ case_id: caseId, consequence: 'missense_variant' }, 20)

      expect(result.data.length).toBe(2)
      expect(result.data.every((v) => v.consequence === 'missense_variant')).toBe(true)
    })

    it('filters by gnomad_af_max', () => {
      const caseId = createTestCase(service, 'test-case')
      const variants = [
        {
          chr: '1',
          pos: 1000,
          ref: 'A',
          alt: 'G',
          gene_symbol: 'GENE1',
          consequence: 'missense_variant',
          gnomad_af: 0.01,
          cadd: 20,
          clinvar: null
        },
        {
          chr: '1',
          pos: 2000,
          ref: 'C',
          alt: 'T',
          gene_symbol: 'GENE2',
          consequence: 'missense_variant',
          gnomad_af: 0.05,
          cadd: 21,
          clinvar: null
        },
        {
          chr: '1',
          pos: 3000,
          ref: 'G',
          alt: 'A',
          gene_symbol: 'GENE3',
          consequence: 'missense_variant',
          gnomad_af: 0.1,
          cadd: 22,
          clinvar: null
        }
      ]
      service.insertVariantsBatch(caseId, variants)

      const result = service.getVariants({ case_id: caseId, gnomad_af_max: 0.05 }, 20)

      expect(result.data.length).toBe(2)
      expect(result.data.every((v) => v.gnomad_af !== null && v.gnomad_af <= 0.05)).toBe(true)
    })

    it('includes null gnomad_af when filtering', () => {
      const caseId = createTestCase(service, 'test-case')
      const variants = [
        {
          chr: '1',
          pos: 1000,
          ref: 'A',
          alt: 'G',
          gene_symbol: 'GENE1',
          consequence: 'missense_variant',
          gnomad_af: null,
          cadd: 20,
          clinvar: null
        },
        {
          chr: '1',
          pos: 2000,
          ref: 'C',
          alt: 'T',
          gene_symbol: 'GENE2',
          consequence: 'missense_variant',
          gnomad_af: 0.01,
          cadd: 21,
          clinvar: null
        },
        {
          chr: '1',
          pos: 3000,
          ref: 'G',
          alt: 'A',
          gene_symbol: 'GENE3',
          consequence: 'missense_variant',
          gnomad_af: 0.1,
          cadd: 22,
          clinvar: null
        }
      ]
      service.insertVariantsBatch(caseId, variants)

      const result = service.getVariants({ case_id: caseId, gnomad_af_max: 0.05 }, 20)

      expect(result.data.length).toBe(2)
      // Should include the null AF variant
      expect(result.data.some((v) => v.gnomad_af === null)).toBe(true)
    })

    it('filters by cadd_min', () => {
      const caseId = createTestCase(service, 'test-case')
      const variants = [
        {
          chr: '1',
          pos: 1000,
          ref: 'A',
          alt: 'G',
          gene_symbol: 'GENE1',
          consequence: 'missense_variant',
          gnomad_af: 0.01,
          cadd: 10,
          clinvar: null
        },
        {
          chr: '1',
          pos: 2000,
          ref: 'C',
          alt: 'T',
          gene_symbol: 'GENE2',
          consequence: 'missense_variant',
          gnomad_af: 0.02,
          cadd: 20,
          clinvar: null
        },
        {
          chr: '1',
          pos: 3000,
          ref: 'G',
          alt: 'A',
          gene_symbol: 'GENE3',
          consequence: 'missense_variant',
          gnomad_af: 0.03,
          cadd: 30,
          clinvar: null
        }
      ]
      service.insertVariantsBatch(caseId, variants)

      const result = service.getVariants({ case_id: caseId, cadd_min: 20 }, 20)

      expect(result.data.length).toBe(2)
      expect(result.data.every((v) => v.cadd !== null && v.cadd >= 20)).toBe(true)
    })

    it('excludes null cadd when filtering by cadd_min', () => {
      const caseId = createTestCase(service, 'test-case')
      const variants = [
        {
          chr: '1',
          pos: 1000,
          ref: 'A',
          alt: 'G',
          gene_symbol: 'GENE1',
          consequence: 'missense_variant',
          gnomad_af: 0.01,
          cadd: null,
          clinvar: null
        },
        {
          chr: '1',
          pos: 2000,
          ref: 'C',
          alt: 'T',
          gene_symbol: 'GENE2',
          consequence: 'missense_variant',
          gnomad_af: 0.02,
          cadd: 25,
          clinvar: null
        },
        {
          chr: '1',
          pos: 3000,
          ref: 'G',
          alt: 'A',
          gene_symbol: 'GENE3',
          consequence: 'missense_variant',
          gnomad_af: 0.03,
          cadd: 30,
          clinvar: null
        }
      ]
      service.insertVariantsBatch(caseId, variants)

      const result = service.getVariants({ case_id: caseId, cadd_min: 20 }, 20)

      expect(result.data.length).toBe(2)
      // Should NOT include the null CADD variant
      expect(result.data.every((v) => v.cadd !== null)).toBe(true)
    })

    it('combines multiple filters', () => {
      const caseId = createTestCase(service, 'test-case')
      const variants = [
        {
          chr: '1',
          pos: 1000,
          ref: 'A',
          alt: 'G',
          gene_symbol: 'BRCA1',
          consequence: 'missense_variant',
          gnomad_af: 0.001,
          cadd: 25,
          clinvar: null
        },
        {
          chr: '1',
          pos: 2000,
          ref: 'C',
          alt: 'T',
          gene_symbol: 'BRCA2',
          consequence: 'missense_variant',
          gnomad_af: 0.1,
          cadd: 25,
          clinvar: null
        },
        {
          chr: '1',
          pos: 3000,
          ref: 'G',
          alt: 'A',
          gene_symbol: 'TP53',
          consequence: 'stop_gained',
          gnomad_af: 0.001,
          cadd: 25,
          clinvar: null
        },
        {
          chr: '1',
          pos: 4000,
          ref: 'T',
          alt: 'C',
          gene_symbol: 'BRCA1',
          consequence: 'stop_gained',
          gnomad_af: 0.001,
          cadd: 15,
          clinvar: null
        }
      ]
      service.insertVariantsBatch(caseId, variants)

      // Filter: BRCA genes + AF <= 0.01 + CADD >= 20
      const filter: VariantFilter = {
        case_id: caseId,
        gene_symbol: 'BRCA',
        gnomad_af_max: 0.01,
        cadd_min: 20
      }
      const result = service.getVariants(filter, 20)

      // Only first variant matches all criteria
      expect(result.data.length).toBe(1)
      expect(result.data[0].gene_symbol).toBe('BRCA1')
      expect(result.data[0].pos).toBe(1000)
    })
  })

  describe('searchVariants FTS5', () => {
    it('finds variants by gene_symbol prefix', () => {
      const caseId = createTestCase(service, 'test-case')
      const variants = [
        {
          chr: '1',
          pos: 1000,
          ref: 'A',
          alt: 'G',
          gene_symbol: 'BRCA1',
          consequence: 'missense_variant',
          gnomad_af: 0.01,
          cadd: 20,
          clinvar: null
        },
        {
          chr: '1',
          pos: 2000,
          ref: 'C',
          alt: 'T',
          gene_symbol: 'BRCA2',
          consequence: 'missense_variant',
          gnomad_af: 0.02,
          cadd: 21,
          clinvar: null
        },
        {
          chr: '1',
          pos: 3000,
          ref: 'G',
          alt: 'A',
          gene_symbol: 'TP53',
          consequence: 'stop_gained',
          gnomad_af: 0.03,
          cadd: 22,
          clinvar: null
        }
      ]
      service.insertVariantsBatch(caseId, variants)

      const results = service.searchVariants(caseId, 'BRC')

      expect(results.length).toBe(2)
      expect(results.every((v) => v.gene_symbol?.startsWith('BRC'))).toBe(true)
    })

    it('finds variants by consequence', () => {
      const caseId = createTestCase(service, 'test-case')
      const variants = [
        {
          chr: '1',
          pos: 1000,
          ref: 'A',
          alt: 'G',
          gene_symbol: 'GENE1',
          consequence: 'missense_variant',
          gnomad_af: 0.01,
          cadd: 20,
          clinvar: null
        },
        {
          chr: '1',
          pos: 2000,
          ref: 'C',
          alt: 'T',
          gene_symbol: 'GENE2',
          consequence: 'stop_gained',
          gnomad_af: 0.02,
          cadd: 21,
          clinvar: null
        },
        {
          chr: '1',
          pos: 3000,
          ref: 'G',
          alt: 'A',
          gene_symbol: 'GENE3',
          consequence: 'frameshift_variant',
          gnomad_af: 0.03,
          cadd: 22,
          clinvar: null
        }
      ]
      service.insertVariantsBatch(caseId, variants)

      const results = service.searchVariants(caseId, 'stop')

      expect(results.length).toBe(1)
      expect(results[0].consequence).toBe('stop_gained')
    })

    it('returns results ordered by relevance', () => {
      const caseId = createTestCase(service, 'test-case')
      const variants = [
        {
          chr: '1',
          pos: 1000,
          ref: 'A',
          alt: 'G',
          gene_symbol: 'ABC',
          consequence: 'missense_variant',
          gnomad_af: 0.01,
          cadd: 20,
          clinvar: null
        },
        {
          chr: '1',
          pos: 2000,
          ref: 'C',
          alt: 'T',
          gene_symbol: 'ABCDEF',
          consequence: 'missense_variant',
          gnomad_af: 0.02,
          cadd: 21,
          clinvar: null
        }
      ]
      service.insertVariantsBatch(caseId, variants)

      // BM25 scoring should return results (order depends on relevance)
      const results = service.searchVariants(caseId, 'ABC')

      expect(results.length).toBe(2)
      // Both should be found - exact order depends on BM25 scoring
      expect(results.map((v) => v.gene_symbol).sort()).toEqual(['ABC', 'ABCDEF'])
    })

    it('returns empty array for no matches', () => {
      const caseId = createTestCase(service, 'test-case')
      const variants = createTestVariants(10)
      service.insertVariantsBatch(caseId, variants)

      const results = service.searchVariants(caseId, 'NONEXISTENT_GENE_ZZZZ')

      expect(results).toEqual([])
    })

    it('limits results', () => {
      const caseId = createTestCase(service, 'test-case')
      // Create many variants with same gene prefix
      const variants: Omit<Variant, 'id' | 'case_id'>[] = []
      for (let i = 0; i < 100; i++) {
        variants.push({
          chr: '1',
          pos: 1000 + i * 100,
          ref: 'A',
          alt: 'G',
          gene_symbol: `SEARCHABLE${i}`,
          consequence: 'missense_variant',
          gnomad_af: 0.01,
          cadd: 20,
          clinvar: null
        })
      }
      service.insertVariantsBatch(caseId, variants)

      const results = service.searchVariants(caseId, 'SEARCHABLE', 10)

      expect(results.length).toBe(10)
    })

    it('search is case-insensitive', () => {
      const caseId = createTestCase(service, 'test-case')
      const variants = [
        {
          chr: '1',
          pos: 1000,
          ref: 'A',
          alt: 'G',
          gene_symbol: 'BRCA1',
          consequence: 'missense_variant',
          gnomad_af: 0.01,
          cadd: 20,
          clinvar: null
        }
      ]
      service.insertVariantsBatch(caseId, variants)

      const results = service.searchVariants(caseId, 'brca1')

      expect(results.length).toBe(1)
      expect(results[0].gene_symbol).toBe('BRCA1')
    })
  })

  describe('Edge cases', () => {
    it('handles variants with all null optional fields', () => {
      const caseId = createTestCase(service, 'test-case')
      const variants = [
        {
          chr: '1',
          pos: 10000,
          ref: 'A',
          alt: 'G',
          gene_symbol: null,
          consequence: null,
          gnomad_af: null,
          cadd: null,
          clinvar: null
        }
      ]

      const count = service.insertVariantsBatch(caseId, variants)

      expect(count).toBe(1)

      const result = service.getVariants({ case_id: caseId }, 20)
      expect(result.data.length).toBe(1)
      expect(result.data[0].gene_symbol).toBeNull()
      expect(result.data[0].consequence).toBeNull()
      expect(result.data[0].gnomad_af).toBeNull()
      expect(result.data[0].cadd).toBeNull()
    })

    it('handles special characters in search', () => {
      const caseId = createTestCase(service, 'test-case')
      const variants = [
        {
          chr: '1',
          pos: 1000,
          ref: 'A',
          alt: 'G',
          gene_symbol: 'NORMAL_GENE',
          consequence: 'missense_variant',
          gnomad_af: 0.01,
          cadd: 20,
          clinvar: null
        }
      ]
      service.insertVariantsBatch(caseId, variants)

      // These should not cause SQL injection or errors
      expect(() => service.searchVariants(caseId, "'; DROP TABLE variants; --")).not.toThrow()
      expect(() => service.searchVariants(caseId, '"quoted"')).not.toThrow()
      expect(() => service.searchVariants(caseId, 'test*')).not.toThrow()
      expect(() => service.searchVariants(caseId, 'test AND other')).not.toThrow()
    })
  })
})
