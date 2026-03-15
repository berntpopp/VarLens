/**
 * CohortService tests
 *
 * Tests for cohort variant aggregation and filtering functionality.
 * All queries now read from pre-computed summary tables, so rebuildSummary()
 * must be called after inserting test data and before querying.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { CohortService } from '../../../src/main/database/cohort'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { CohortSummaryService } from '../../../src/main/database/CohortSummaryService'

describe('CohortService', () => {
  let db: Database.Database
  let cohortService: CohortService
  let summaryService: CohortSummaryService

  // Helper to insert a case
  const insertCase = (name: string): number => {
    const stmt = db.prepare(
      'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    const result = stmt.run(name, `/test/path/${name}.json`, 1000, 0, Date.now())
    return result.lastInsertRowid as number
  }

  // Helper to insert a variant
  const insertVariant = (
    caseId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    options: {
      gene_symbol?: string
      consequence?: string
      func?: string
      clinvar?: string
      gnomad_af?: number
      cadd?: number
      gt_num?: string
      cdna?: string
      aa_change?: string
    } = {}
  ): void => {
    const stmt = db.prepare(`
      INSERT INTO variants (
        case_id, chr, pos, ref, alt, gene_symbol, consequence, func, clinvar,
        gnomad_af, cadd, gt_num, cdna, aa_change
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      caseId,
      chr,
      pos,
      ref,
      alt,
      options.gene_symbol ?? null,
      options.consequence ?? null,
      options.func ?? null,
      options.clinvar ?? null,
      options.gnomad_af ?? null,
      options.cadd ?? null,
      options.gt_num ?? '0/1',
      options.cdna ?? null,
      options.aa_change ?? null
    )
  }

  const rebuildSummary = (): void => {
    summaryService.rebuild()
  }

  beforeEach(() => {
    // Create in-memory database
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
    cohortService = new CohortService(db)
    summaryService = new CohortSummaryService(db)
  })

  afterEach(() => {
    cohortService.close()
    db.close()
  })

  describe('getCohortVariants', () => {
    it('should return empty result when no cases exist', () => {
      const result = cohortService.getCohortVariants({})
      expect(result.data).toEqual([])
      expect(result.total_count).toBe(0)
    })

    it('should aggregate variants across multiple cases', () => {
      const case1 = insertCase('Case 1')
      const case2 = insertCase('Case 2')

      // Same variant in both cases
      insertVariant(case1, '1', 12345, 'A', 'G', { gene_symbol: 'BRCA1' })
      insertVariant(case2, '1', 12345, 'A', 'G', { gene_symbol: 'BRCA1' })

      // Unique variant in case 1 only
      insertVariant(case1, '2', 54321, 'C', 'T', { gene_symbol: 'TP53' })

      rebuildSummary()
      const result = cohortService.getCohortVariants({})

      expect(result.total_count).toBe(2)
      expect(result.data.length).toBe(2)

      // Shared variant should have carrier_count = 2
      const sharedVariant = result.data.find((v) => v.pos === 12345)
      expect(sharedVariant?.carrier_count).toBe(2)
      expect(sharedVariant?.cohort_frequency).toBe(1.0)

      // Unique variant should have carrier_count = 1
      const uniqueVariant = result.data.find((v) => v.pos === 54321)
      expect(uniqueVariant?.carrier_count).toBe(1)
      expect(uniqueVariant?.cohort_frequency).toBe(0.5)
    })

    it('should calculate het_count and hom_count correctly', () => {
      const case1 = insertCase('Case 1')
      const case2 = insertCase('Case 2')
      const case3 = insertCase('Case 3')

      // Same variant: 2 het, 1 hom
      insertVariant(case1, '1', 100, 'A', 'G', { gt_num: '0/1' })
      insertVariant(case2, '1', 100, 'A', 'G', { gt_num: '1/1' })
      insertVariant(case3, '1', 100, 'A', 'G', { gt_num: '0/1' })

      rebuildSummary()
      const result = cohortService.getCohortVariants({})

      expect(result.data[0].het_count).toBe(2)
      expect(result.data[0].hom_count).toBe(1)
    })

    describe('filter: gene_symbol', () => {
      it('should filter by exact gene symbol match', () => {
        const caseId = insertCase('Test Case')
        insertVariant(caseId, '1', 100, 'A', 'G', { gene_symbol: 'BRCA1' })
        insertVariant(caseId, '2', 200, 'C', 'T', { gene_symbol: 'TP53' })
        insertVariant(caseId, '3', 300, 'G', 'A', { gene_symbol: 'BRCA2' })

        rebuildSummary()
        const result = cohortService.getCohortVariants({ gene_symbol: 'BRCA1' })

        expect(result.total_count).toBe(1)
        expect(result.data[0].gene_symbol).toBe('BRCA1')
      })
    })

    describe('filter: consequences (Impact)', () => {
      it('should filter by single consequence', () => {
        const caseId = insertCase('Test Case')
        insertVariant(caseId, '1', 100, 'A', 'G', { consequence: 'HIGH' })
        insertVariant(caseId, '2', 200, 'C', 'T', { consequence: 'MODERATE' })
        insertVariant(caseId, '3', 300, 'G', 'A', { consequence: 'LOW' })

        rebuildSummary()
        const result = cohortService.getCohortVariants({ consequences: ['HIGH'] })

        expect(result.total_count).toBe(1)
        expect(result.data[0].consequence).toBe('HIGH')
      })

      it('should filter by multiple consequences', () => {
        const caseId = insertCase('Test Case')
        insertVariant(caseId, '1', 100, 'A', 'G', { consequence: 'HIGH' })
        insertVariant(caseId, '2', 200, 'C', 'T', { consequence: 'MODERATE' })
        insertVariant(caseId, '3', 300, 'G', 'A', { consequence: 'LOW' })

        rebuildSummary()
        const result = cohortService.getCohortVariants({ consequences: ['HIGH', 'MODERATE'] })

        expect(result.total_count).toBe(2)
        const consequences = result.data.map((v) => v.consequence)
        expect(consequences).toContain('HIGH')
        expect(consequences).toContain('MODERATE')
        expect(consequences).not.toContain('LOW')
      })
    })

    describe('filter: funcs', () => {
      it('should filter by functional consequence types', () => {
        const caseId = insertCase('Test Case')
        insertVariant(caseId, '1', 100, 'A', 'G', { func: 'missense_variant' })
        insertVariant(caseId, '2', 200, 'C', 'T', { func: 'synonymous_variant' })
        insertVariant(caseId, '3', 300, 'G', 'A', { func: 'frameshift_variant' })

        rebuildSummary()
        const result = cohortService.getCohortVariants({
          funcs: ['missense_variant', 'frameshift_variant']
        })

        expect(result.total_count).toBe(2)
        const funcs = result.data.map((v) => v.func)
        expect(funcs).toContain('missense_variant')
        expect(funcs).toContain('frameshift_variant')
        expect(funcs).not.toContain('synonymous_variant')
      })
    })

    describe('filter: clinvars', () => {
      it('should filter by ClinVar classification with exact match', () => {
        const caseId = insertCase('Test Case')
        insertVariant(caseId, '1', 100, 'A', 'G', { clinvar: 'Pathogenic' })
        insertVariant(caseId, '2', 200, 'C', 'T', { clinvar: 'Likely_pathogenic' })
        insertVariant(caseId, '3', 300, 'G', 'A', { clinvar: 'Benign' })
        insertVariant(caseId, '4', 400, 'T', 'C', { clinvar: 'Uncertain_significance' })

        rebuildSummary()
        const result = cohortService.getCohortVariants({ clinvars: ['Pathogenic'] })

        expect(result.total_count).toBe(1) // Exact match only
        const clinvars = result.data.map((v) => v.clinvar)
        expect(clinvars).toContain('Pathogenic')
        expect(clinvars).not.toContain('Likely_pathogenic')
      })
    })

    describe('filter: gnomad_af_max', () => {
      it('should filter by maximum gnomAD allele frequency', () => {
        const caseId = insertCase('Test Case')
        insertVariant(caseId, '1', 100, 'A', 'G', { gnomad_af: 0.001 })
        insertVariant(caseId, '2', 200, 'C', 'T', { gnomad_af: 0.05 })
        insertVariant(caseId, '3', 300, 'G', 'A', { gnomad_af: 0.5 })

        rebuildSummary()
        const result = cohortService.getCohortVariants({ gnomad_af_max: 0.01 })

        expect(result.total_count).toBe(1)
        expect(result.data[0].gnomad_af).toBe(0.001)
      })

      it('should include variants with NULL gnomad_af when filter is applied', () => {
        const caseId = insertCase('Test Case')
        insertVariant(caseId, '1', 100, 'A', 'G', { gnomad_af: 0.001 })
        insertVariant(caseId, '2', 200, 'C', 'T', {}) // NULL gnomad_af
        insertVariant(caseId, '3', 300, 'G', 'A', { gnomad_af: 0.5 })

        rebuildSummary()
        const result = cohortService.getCohortVariants({ gnomad_af_max: 0.01 })

        expect(result.total_count).toBe(2) // Includes rare variant AND null
        const positions = result.data.map((v) => v.pos)
        expect(positions).toContain(100)
        expect(positions).toContain(200)
      })
    })

    describe('filter: cadd_min', () => {
      it('should filter by minimum CADD score', () => {
        const caseId = insertCase('Test Case')
        insertVariant(caseId, '1', 100, 'A', 'G', { cadd: 30 })
        insertVariant(caseId, '2', 200, 'C', 'T', { cadd: 15 })
        insertVariant(caseId, '3', 300, 'G', 'A', { cadd: 5 })

        rebuildSummary()
        const result = cohortService.getCohortVariants({ cadd_min: 20 })

        expect(result.total_count).toBe(1)
        expect(result.data[0].cadd_phred).toBe(30)
      })
    })

    describe('filter: carrier_count_min', () => {
      it('should filter by minimum carrier count', () => {
        const case1 = insertCase('Case 1')
        const case2 = insertCase('Case 2')
        const case3 = insertCase('Case 3')

        // Variant in all 3 cases
        insertVariant(case1, '1', 100, 'A', 'G')
        insertVariant(case2, '1', 100, 'A', 'G')
        insertVariant(case3, '1', 100, 'A', 'G')

        // Variant in 2 cases
        insertVariant(case1, '2', 200, 'C', 'T')
        insertVariant(case2, '2', 200, 'C', 'T')

        // Variant in 1 case
        insertVariant(case1, '3', 300, 'G', 'A')

        rebuildSummary()
        const result = cohortService.getCohortVariants({ carrier_count_min: 2 })

        expect(result.total_count).toBe(2)
        result.data.forEach((v) => {
          expect(v.carrier_count).toBeGreaterThanOrEqual(2)
        })
      })
    })

    describe('filter: cohort_frequency_min', () => {
      it('should filter by minimum cohort frequency', () => {
        const case1 = insertCase('Case 1')
        const case2 = insertCase('Case 2')

        // Variant in both cases (100% frequency)
        insertVariant(case1, '1', 100, 'A', 'G')
        insertVariant(case2, '1', 100, 'A', 'G')

        // Variant in 1 case (50% frequency)
        insertVariant(case1, '2', 200, 'C', 'T')

        rebuildSummary()
        const result = cohortService.getCohortVariants({ cohort_frequency_min: 0.75 })

        expect(result.total_count).toBe(1)
        expect(result.data[0].cohort_frequency).toBe(1.0)
      })
    })

    describe('combined filters', () => {
      it('should apply multiple filters together', () => {
        const case1 = insertCase('Case 1')
        const case2 = insertCase('Case 2')

        // Variant matching all criteria
        insertVariant(case1, '1', 100, 'A', 'G', {
          gene_symbol: 'BRCA1',
          consequence: 'HIGH',
          gnomad_af: 0.0001,
          cadd: 25
        })
        insertVariant(case2, '1', 100, 'A', 'G', {
          gene_symbol: 'BRCA1',
          consequence: 'HIGH',
          gnomad_af: 0.0001,
          cadd: 25
        })

        // Variant with wrong gene
        insertVariant(case1, '2', 200, 'C', 'T', {
          gene_symbol: 'TP53',
          consequence: 'HIGH',
          gnomad_af: 0.0001,
          cadd: 25
        })

        // Variant with wrong consequence
        insertVariant(case1, '3', 300, 'G', 'A', {
          gene_symbol: 'BRCA1',
          consequence: 'LOW',
          gnomad_af: 0.0001,
          cadd: 25
        })

        // Variant with too high gnomAD AF
        insertVariant(case1, '4', 400, 'T', 'C', {
          gene_symbol: 'BRCA1',
          consequence: 'HIGH',
          gnomad_af: 0.1,
          cadd: 25
        })

        rebuildSummary()
        const result = cohortService.getCohortVariants({
          gene_symbol: 'BRCA1',
          consequences: ['HIGH'],
          gnomad_af_max: 0.01,
          cadd_min: 20,
          carrier_count_min: 2
        })

        expect(result.total_count).toBe(1)
        expect(result.data[0].pos).toBe(100)
      })
    })

    describe('pagination', () => {
      it('should return first page with offset 0', () => {
        const caseId = insertCase('Test Case')
        for (let i = 0; i < 10; i++) {
          insertVariant(caseId, '1', 100 + i, 'A', 'G')
        }

        rebuildSummary()
        const result = cohortService.getCohortVariants({ limit: 3 })

        expect(result.data.length).toBe(3)
        expect(result.total_count).toBe(10)
      })

      it('should return subsequent pages using offset', () => {
        const caseId = insertCase('Test Case')
        for (let i = 0; i < 10; i++) {
          insertVariant(caseId, '1', 100 + i, 'A', 'G')
        }

        rebuildSummary()

        // Get first page
        const page1 = cohortService.getCohortVariants({ limit: 3, offset: 0 })
        expect(page1.data.length).toBe(3)

        // Get second page using offset
        const page2 = cohortService.getCohortVariants({ limit: 3, offset: 3 })
        expect(page2.data.length).toBe(3)
        expect(page2.total_count).toBe(10)

        // Pages should have different variants
        const page1Keys = page1.data.map((v) => v.variant_key)
        const page2Keys = page2.data.map((v) => v.variant_key)
        expect(page1Keys).not.toEqual(page2Keys)
        // No overlap between pages
        for (const key of page2Keys) {
          expect(page1Keys).not.toContain(key)
        }
      })

      it('should return partial last page', () => {
        const caseId = insertCase('Test Case')
        for (let i = 0; i < 5; i++) {
          insertVariant(caseId, '1', 100 + i, 'A', 'G')
        }

        rebuildSummary()
        const page2 = cohortService.getCohortVariants({ limit: 3, offset: 3 })
        expect(page2.data.length).toBe(2)
      })

      it('should return empty data when offset exceeds total', () => {
        const caseId = insertCase('Test Case')
        for (let i = 0; i < 5; i++) {
          insertVariant(caseId, '1', 100 + i, 'A', 'G')
        }

        rebuildSummary()
        const result = cohortService.getCohortVariants({ limit: 3, offset: 9999 })
        expect(result.data).toEqual([])
        expect(result.total_count).toBe(5)
      })

      it('should paginate correctly with sort by pos ascending', () => {
        const caseId = insertCase('Test Case')
        for (let i = 0; i < 6; i++) {
          insertVariant(caseId, '1', 100 + i, 'A', 'G')
        }

        rebuildSummary()

        const page1 = cohortService.getCohortVariants({
          limit: 3,
          offset: 0,
          sort_by: 'pos',
          sort_order: 'asc'
        })
        expect(page1.data.map((v) => v.pos)).toEqual([100, 101, 102])

        const page2 = cohortService.getCohortVariants({
          limit: 3,
          offset: 3,
          sort_by: 'pos',
          sort_order: 'asc'
        })
        expect(page2.data.map((v) => v.pos)).toEqual([103, 104, 105])
      })

      it('should handle NULL sort values across pages', () => {
        const case1 = insertCase('Case 1')
        const case2 = insertCase('Case 2')

        // Some variants with gnomad_af, some without
        insertVariant(case1, '1', 100, 'A', 'G', { gnomad_af: 0.01 })
        insertVariant(case1, '2', 200, 'C', 'T', {}) // NULL gnomad_af
        insertVariant(case2, '3', 300, 'G', 'A', { gnomad_af: 0.05 })
        insertVariant(case1, '4', 400, 'T', 'C', {}) // NULL gnomad_af

        rebuildSummary()

        const page1 = cohortService.getCohortVariants({
          limit: 2,
          offset: 0,
          sort_by: 'gnomad_af',
          sort_order: 'desc'
        })
        expect(page1.data.length).toBe(2)

        const page2 = cohortService.getCohortVariants({
          limit: 2,
          offset: 2,
          sort_by: 'gnomad_af',
          sort_order: 'desc'
        })
        expect(page2.data.length).toBe(2)

        // All 4 variants should appear across both pages (no duplicates)
        const allKeys = [
          ...page1.data.map((v) => v.variant_key),
          ...page2.data.map((v) => v.variant_key)
        ]
        expect(new Set(allKeys).size).toBe(4)
      })

      it('should traverse all results across pages without duplicates', () => {
        const case1 = insertCase('Case 1')
        const case2 = insertCase('Case 2')

        // 5 unique variants (7 rows, 2 shared across cases) with varying carrier counts
        insertVariant(case1, '1', 100, 'A', 'G')
        insertVariant(case2, '1', 100, 'A', 'G') // shared: carrier_count=2
        insertVariant(case1, '2', 200, 'C', 'T')
        insertVariant(case2, '2', 200, 'C', 'T') // shared: carrier_count=2
        insertVariant(case1, '3', 300, 'G', 'A')
        insertVariant(case1, '4', 400, 'T', 'C')
        insertVariant(case1, '5', 500, 'A', 'T')

        rebuildSummary()

        // Paginate through all results
        const allVariantKeys: string[] = []
        let offset = 0
        const limit = 2

        while (offset < 20) {
          // safety limit
          const result = cohortService.getCohortVariants({ limit, offset })
          if (result.data.length === 0) break
          allVariantKeys.push(...result.data.map((v) => v.variant_key))
          offset += limit
        }

        // All 5 unique variants should appear exactly once
        expect(allVariantKeys.length).toBe(5)
        expect(new Set(allVariantKeys).size).toBe(5)
      })
    })

    describe('sorting', () => {
      it('should sort by carrier_count descending by default', () => {
        const case1 = insertCase('Case 1')
        const case2 = insertCase('Case 2')

        insertVariant(case1, '1', 100, 'A', 'G')
        insertVariant(case1, '2', 200, 'C', 'T')
        insertVariant(case2, '2', 200, 'C', 'T')

        rebuildSummary()
        const result = cohortService.getCohortVariants({})

        expect(result.data[0].carrier_count).toBe(2)
        expect(result.data[1].carrier_count).toBe(1)
      })

      it('should support custom sorting', () => {
        const caseId = insertCase('Test Case')
        insertVariant(caseId, '1', 300, 'A', 'G')
        insertVariant(caseId, '1', 100, 'C', 'T')
        insertVariant(caseId, '1', 200, 'G', 'A')

        rebuildSummary()
        const result = cohortService.getCohortVariants({ sort_by: 'pos', sort_order: 'asc' })

        expect(result.data[0].pos).toBe(100)
        expect(result.data[1].pos).toBe(200)
        expect(result.data[2].pos).toBe(300)
      })

      // Test all sortable columns to ensure they are in SORTABLE_COLUMNS mapping
      describe('all sortable columns', () => {
        beforeEach(() => {
          const caseId = insertCase('Test Case')
          insertVariant(caseId, '2', 200, 'A', 'G', {
            gene_symbol: 'BRCA2',
            consequence: 'HIGH',
            func: 'missense',
            clinvar: 'Pathogenic',
            gnomad_af: 0.01,
            cadd: 25,
            gt_num: '0/1'
          })
          insertVariant(caseId, '1', 100, 'C', 'T', {
            gene_symbol: 'BRCA1',
            consequence: 'MODERATE',
            func: 'synonymous',
            clinvar: 'Benign',
            gnomad_af: 0.05,
            cadd: 15,
            gt_num: '1/1'
          })
          rebuildSummary()
        })

        it.each([
          ['chr'],
          ['pos'],
          ['gene_symbol'],
          ['cdna'],
          ['aa_change'],
          ['carrier_count'],
          ['cohort_frequency'],
          ['het_count'],
          ['hom_count'],
          ['consequence'],
          ['func'],
          ['clinvar'],
          ['gnomad_af'],
          ['cadd_phred']
        ])('should sort by %s without error', (sortBy) => {
          // This test ensures each column in SORTABLE_COLUMNS is valid
          const resultAsc = cohortService.getCohortVariants({
            sort_by: sortBy,
            sort_order: 'asc'
          })
          expect(resultAsc.data.length).toBeGreaterThan(0)

          const resultDesc = cohortService.getCohortVariants({
            sort_by: sortBy,
            sort_order: 'desc'
          })
          expect(resultDesc.data.length).toBeGreaterThan(0)
        })
      })

      it('should sort NULL values last when sorting ascending', () => {
        const caseId = insertCase('Null Sort Case')
        insertVariant(caseId, '1', 100, 'A', 'G', { gnomad_af: 0.05 })
        insertVariant(caseId, '1', 200, 'C', 'T', {}) // gnomad_af is NULL
        insertVariant(caseId, '1', 300, 'G', 'A', { gnomad_af: 0.001 })
        rebuildSummary()

        const result = cohortService.getCohortVariants({
          sort_by: 'gnomad_af',
          sort_order: 'asc'
        })

        // Non-null values first in ascending order, then nulls last
        expect(result.data[0].gnomad_af).toBe(0.001)
        expect(result.data[1].gnomad_af).toBe(0.05)
        expect(result.data[2].gnomad_af).toBeNull()
      })

      it('should sort NULL values last when sorting descending', () => {
        const caseId = insertCase('Null Sort Desc Case')
        insertVariant(caseId, '1', 100, 'A', 'G', { gnomad_af: 0.05 })
        insertVariant(caseId, '1', 200, 'C', 'T', {}) // gnomad_af is NULL
        insertVariant(caseId, '1', 300, 'G', 'A', { gnomad_af: 0.001 })
        rebuildSummary()

        const result = cohortService.getCohortVariants({
          sort_by: 'gnomad_af',
          sort_order: 'desc'
        })

        // Non-null values first in descending order, then nulls last
        expect(result.data[0].gnomad_af).toBe(0.05)
        expect(result.data[1].gnomad_af).toBe(0.001)
        expect(result.data[2].gnomad_af).toBeNull()
      })

      it('should sort NULL CADD values last in both directions', () => {
        const caseId = insertCase('Null CADD Case')
        insertVariant(caseId, '1', 100, 'A', 'G', { cadd: 25 })
        insertVariant(caseId, '1', 200, 'C', 'T', {}) // cadd is NULL
        insertVariant(caseId, '1', 300, 'G', 'A', { cadd: 15 })
        rebuildSummary()

        // Ascending
        const ascResult = cohortService.getCohortVariants({
          sort_by: 'cadd_phred',
          sort_order: 'asc'
        })
        expect(ascResult.data[0].cadd_phred).toBe(15)
        expect(ascResult.data[1].cadd_phred).toBe(25)
        expect(ascResult.data[2].cadd_phred).toBeNull()

        // Descending
        const descResult = cohortService.getCohortVariants({
          sort_by: 'cadd_phred',
          sort_order: 'desc'
        })
        expect(descResult.data[0].cadd_phred).toBe(25)
        expect(descResult.data[1].cadd_phred).toBe(15)
        expect(descResult.data[2].cadd_phred).toBeNull()
      })
    })
  })

  describe('getCohortSummary', () => {
    it('should return correct summary statistics', () => {
      const case1 = insertCase('Case 1')
      const case2 = insertCase('Case 2')

      // 3 unique variants, 4 total observations
      insertVariant(case1, '1', 100, 'A', 'G', { gene_symbol: 'GENE1' })
      insertVariant(case2, '1', 100, 'A', 'G', { gene_symbol: 'GENE1' })
      insertVariant(case1, '2', 200, 'C', 'T', { gene_symbol: 'GENE2' })
      insertVariant(case1, '3', 300, 'G', 'A', { gene_symbol: 'GENE2' })

      rebuildSummary()
      const summary = cohortService.getCohortSummary()

      expect(summary.total_cases).toBe(2)
      expect(summary.total_variants).toBe(4)
      expect(summary.unique_variants).toBe(3)
      expect(summary.avg_variants_per_case).toBe(2)
      expect(summary.genes_with_variants).toBe(2)
    })
  })

  describe('getCarriers', () => {
    it('should return carriers for a specific variant', () => {
      const case1 = insertCase('Patient A')
      const case2 = insertCase('Patient B')

      insertVariant(case1, '1', 12345, 'A', 'G', { gt_num: '0/1' })
      insertVariant(case2, '1', 12345, 'A', 'G', { gt_num: '1/1' })

      const carriers = cohortService.getCarriers('1', 12345, 'A', 'G')

      expect(carriers.length).toBe(2)
      expect(carriers.map((c) => c.case_name)).toContain('Patient A')
      expect(carriers.map((c) => c.case_name)).toContain('Patient B')

      const patientA = carriers.find((c) => c.case_name === 'Patient A')
      expect(patientA?.gt_num).toBe('0/1')

      const patientB = carriers.find((c) => c.case_name === 'Patient B')
      expect(patientB?.gt_num).toBe('1/1')
    })
  })

  describe('getGeneBurden', () => {
    it('should return gene-level burden statistics', () => {
      const case1 = insertCase('Case 1')
      const case2 = insertCase('Case 2')

      // BRCA1: 3 variants, 2 unique, 2 cases affected
      insertVariant(case1, '1', 100, 'A', 'G', { gene_symbol: 'BRCA1' })
      insertVariant(case1, '1', 200, 'C', 'T', { gene_symbol: 'BRCA1' })
      insertVariant(case2, '1', 100, 'A', 'G', { gene_symbol: 'BRCA1' })

      // TP53: 1 variant, 1 case affected
      insertVariant(case1, '2', 300, 'G', 'A', { gene_symbol: 'TP53' })

      rebuildSummary()
      const burden = cohortService.getGeneBurden()

      expect(burden.length).toBe(2)

      const brca1 = burden.find((g) => g.gene_symbol === 'BRCA1')
      expect(brca1?.variant_count).toBe(3)
      expect(brca1?.unique_variant_count).toBe(2)
      expect(brca1?.affected_case_count).toBe(2)
      expect(brca1?.total_cases).toBe(2)

      const tp53 = burden.find((g) => g.gene_symbol === 'TP53')
      expect(tp53?.variant_count).toBe(1)
      expect(tp53?.affected_case_count).toBe(1)
    })
  })

  describe('getCohortVariants column_filters', () => {
    it('should filter by text column with partial match', () => {
      const case1 = insertCase('Case 1')
      const case2 = insertCase('Case 2')

      insertVariant(case1, '1', 100, 'A', 'G', { gene_symbol: 'BRCA1' })
      insertVariant(case2, '1', 200, 'C', 'T', { gene_symbol: 'BRCA2' })
      insertVariant(case1, '2', 300, 'G', 'A', { gene_symbol: 'TP53' })

      rebuildSummary()
      const result = cohortService.getCohortVariants({
        column_filters: { gene_symbol: { operator: 'like', value: 'BRCA' } }
      })
      expect(result.total_count).toBe(2)
      expect(result.data.every((v) => v.gene_symbol?.includes('BRCA'))).toBe(true)
    })

    it('should combine multiple column filters with AND logic', () => {
      const case1 = insertCase('Case 1')

      insertVariant(case1, '1', 100, 'A', 'G', {
        gene_symbol: 'BRCA1',
        clinvar: 'Pathogenic'
      })
      insertVariant(case1, '1', 200, 'C', 'T', {
        gene_symbol: 'BRCA2',
        clinvar: 'Benign'
      })
      insertVariant(case1, '2', 300, 'G', 'A', {
        gene_symbol: 'TP53',
        clinvar: 'Pathogenic'
      })

      rebuildSummary()
      const result = cohortService.getCohortVariants({
        column_filters: {
          gene_symbol: { operator: 'like', value: 'BRCA' },
          clinvar: { operator: 'like', value: 'Pathogenic' }
        }
      })
      expect(result.total_count).toBe(1)
      expect(result.data[0].gene_symbol).toBe('BRCA1')
    })

    it('should safely ignore unknown column keys', () => {
      const case1 = insertCase('Case 1')
      insertVariant(case1, '1', 100, 'A', 'G')

      rebuildSummary()
      const result = cohortService.getCohortVariants({
        column_filters: { nonexistent_column: { operator: 'like', value: 'test' } }
      })
      expect(result.total_count).toBe(1)
    })

    it('should skip empty string filter values', () => {
      const case1 = insertCase('Case 1')
      insertVariant(case1, '1', 100, 'A', 'G', { gene_symbol: 'BRCA1' })
      insertVariant(case1, '1', 200, 'C', 'T', { gene_symbol: 'TP53' })

      rebuildSummary()
      const result = cohortService.getCohortVariants({
        column_filters: { gene_symbol: { operator: 'like', value: '' } }
      })
      expect(result.total_count).toBe(2)
    })

    it('should filter by cadd_phred using raw variants.cadd column', () => {
      const caseId = insertCase('case1')
      insertVariant(caseId, '1', 100, 'A', 'G', { cadd: 30 })
      insertVariant(caseId, '1', 200, 'C', 'T', { cadd: 15 })
      insertVariant(caseId, '1', 300, 'G', 'A', { cadd: 5 })

      rebuildSummary()
      const result = cohortService.getCohortVariants({
        column_filters: { cadd_phred: { operator: '=', value: 30 } }
      })

      expect(result.data.length).toBe(1)
      expect(result.data[0].cadd_phred).toBe(30)
    })
  })

  describe('annotation column filters', () => {
    it('should filter by has_star column (not EXISTS subquery)', () => {
      const caseId = insertCase('test')
      insertVariant(caseId, '1', 100, 'A', 'G', { gene_symbol: 'BRCA1' })
      insertVariant(caseId, '1', 200, 'C', 'T', { gene_symbol: 'TP53' })
      summaryService.rebuild()

      db.prepare(
        `INSERT INTO variant_annotations (chr, pos, ref, alt, starred, created_at, updated_at)
         VALUES ('1', 100, 'A', 'G', 1, 0, 0)`
      ).run()

      const result = cohortService.getCohortVariants({ starred_only: true })
      expect(result.data).toHaveLength(1)
      expect(result.data[0].gene_symbol).toBe('BRCA1')
    })

    it('should skip count query when _count_needed is false', () => {
      const caseId = insertCase('test')
      insertVariant(caseId, '1', 100, 'A', 'G', { gene_symbol: 'BRCA1' })
      insertVariant(caseId, '1', 200, 'C', 'T', { gene_symbol: 'TP53' })
      summaryService.rebuild()

      // With _count_needed: false, total_count should be 0 (not computed)
      const result = cohortService.getCohortVariants({ _count_needed: false })
      expect(result.total_count).toBe(0)
      expect(result.data.length).toBeGreaterThan(0)

      // With _count_needed: true (default), total_count should be computed
      const result2 = cohortService.getCohortVariants({})
      expect(result2.total_count).toBe(2)
    })
  })
})
