/**
 * CohortService tests
 *
 * Tests for cohort variant aggregation and filtering functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { CohortService } from '../../../src/main/database/cohort'
import { initializeSchema } from '../../../src/main/database/schema'

describe('CohortService', () => {
  let db: Database.Database
  let cohortService: CohortService

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

  beforeEach(() => {
    // Create in-memory database
    db = new Database(':memory:')
    initializeSchema(db)
    cohortService = new CohortService(db)
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

        const result = cohortService.getCohortVariants({ consequences: ['HIGH'] })

        expect(result.total_count).toBe(1)
        expect(result.data[0].consequence).toBe('HIGH')
      })

      it('should filter by multiple consequences', () => {
        const caseId = insertCase('Test Case')
        insertVariant(caseId, '1', 100, 'A', 'G', { consequence: 'HIGH' })
        insertVariant(caseId, '2', 200, 'C', 'T', { consequence: 'MODERATE' })
        insertVariant(caseId, '3', 300, 'G', 'A', { consequence: 'LOW' })

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
      it('should filter by ClinVar classification with partial match', () => {
        const caseId = insertCase('Test Case')
        insertVariant(caseId, '1', 100, 'A', 'G', { clinvar: 'Pathogenic' })
        insertVariant(caseId, '2', 200, 'C', 'T', { clinvar: 'Likely_pathogenic' })
        insertVariant(caseId, '3', 300, 'G', 'A', { clinvar: 'Benign' })
        insertVariant(caseId, '4', 400, 'T', 'C', { clinvar: 'Uncertain_significance' })

        const result = cohortService.getCohortVariants({ clinvars: ['Pathogenic'] })

        expect(result.total_count).toBe(2) // Matches both Pathogenic and Likely_pathogenic
        const clinvars = result.data.map((v) => v.clinvar)
        expect(clinvars).toContain('Pathogenic')
        expect(clinvars).toContain('Likely_pathogenic')
      })
    })

    describe('filter: gnomad_af_max', () => {
      it('should filter by maximum gnomAD allele frequency', () => {
        const caseId = insertCase('Test Case')
        insertVariant(caseId, '1', 100, 'A', 'G', { gnomad_af: 0.001 })
        insertVariant(caseId, '2', 200, 'C', 'T', { gnomad_af: 0.05 })
        insertVariant(caseId, '3', 300, 'G', 'A', { gnomad_af: 0.5 })

        const result = cohortService.getCohortVariants({ gnomad_af_max: 0.01 })

        expect(result.total_count).toBe(1)
        expect(result.data[0].gnomad_af).toBe(0.001)
      })

      it('should include variants with NULL gnomad_af when filter is applied', () => {
        const caseId = insertCase('Test Case')
        insertVariant(caseId, '1', 100, 'A', 'G', { gnomad_af: 0.001 })
        insertVariant(caseId, '2', 200, 'C', 'T', {}) // NULL gnomad_af
        insertVariant(caseId, '3', 300, 'G', 'A', { gnomad_af: 0.5 })

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
      it('should respect limit and offset', () => {
        const caseId = insertCase('Test Case')
        for (let i = 0; i < 10; i++) {
          insertVariant(caseId, '1', 100 + i, 'A', 'G')
        }

        const page1 = cohortService.getCohortVariants({ limit: 3, offset: 0 })
        const page2 = cohortService.getCohortVariants({ limit: 3, offset: 3 })

        expect(page1.data.length).toBe(3)
        expect(page2.data.length).toBe(3)
        expect(page1.total_count).toBe(10)
        expect(page2.total_count).toBe(10)

        // Pages should have different variants
        const page1Positions = page1.data.map((v) => v.pos)
        const page2Positions = page2.data.map((v) => v.pos)
        expect(page1Positions).not.toEqual(page2Positions)
      })
    })

    describe('sorting', () => {
      it('should sort by carrier_count descending by default', () => {
        const case1 = insertCase('Case 1')
        const case2 = insertCase('Case 2')

        insertVariant(case1, '1', 100, 'A', 'G')
        insertVariant(case1, '2', 200, 'C', 'T')
        insertVariant(case2, '2', 200, 'C', 'T')

        const result = cohortService.getCohortVariants({})

        expect(result.data[0].carrier_count).toBe(2)
        expect(result.data[1].carrier_count).toBe(1)
      })

      it('should support custom sorting', () => {
        const caseId = insertCase('Test Case')
        insertVariant(caseId, '1', 300, 'A', 'G')
        insertVariant(caseId, '1', 100, 'C', 'T')
        insertVariant(caseId, '1', 200, 'G', 'A')

        const result = cohortService.getCohortVariants({ sort_by: 'pos', sort_order: 'asc' })

        expect(result.data[0].pos).toBe(100)
        expect(result.data[1].pos).toBe(200)
        expect(result.data[2].pos).toBe(300)
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
})
