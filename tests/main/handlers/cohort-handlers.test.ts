/**
 * Cohort IPC handler integration tests
 *
 * Tests IPC handlers with real SQLite backend and snapshot verification.
 * Addresses TEST-04 (integration with real DB), TEST-05 (filter parity), TEST-08 (snapshot contracts).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { CohortService } from '../../../src/main/database/cohort'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { CohortSummaryService } from '../../../src/main/database/CohortSummaryService'

describe('cohort IPC handlers', () => {
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
      transcript?: string
      omim_mim_number?: string
    } = {}
  ): void => {
    const stmt = db.prepare(`
      INSERT INTO variants (
        case_id, chr, pos, ref, alt, gene_symbol, consequence, func, clinvar,
        gnomad_af, cadd, gt_num, cdna, aa_change, transcript, omim_mim_number
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      options.aa_change ?? null,
      options.transcript ?? null,
      options.omim_mim_number ?? null
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

  describe('getCohortVariants - IPC payload structure', () => {
    it('returns expected payload structure (snapshot)', () => {
      const case1 = insertCase('Case 1')
      const case2 = insertCase('Case 2')

      // Insert test variants with rich data
      insertVariant(case1, '1', 12345, 'A', 'G', {
        gene_symbol: 'BRCA1',
        consequence: 'HIGH',
        func: 'missense_variant',
        clinvar: 'Pathogenic',
        gnomad_af: 0.0001,
        cadd: 25.5,
        cdna: 'c.123G>A',
        aa_change: 'p.Arg41His',
        transcript: 'ENST00000357654',
        omim_mim_number: '113705'
      })
      insertVariant(case2, '1', 12345, 'A', 'G', {
        gene_symbol: 'BRCA1',
        consequence: 'HIGH',
        func: 'missense_variant',
        clinvar: 'Pathogenic',
        gnomad_af: 0.0001,
        cadd: 25.5
      })
      insertVariant(case1, '2', 54321, 'C', 'T', {
        gene_symbol: 'TP53',
        consequence: 'MODERATE',
        gnomad_af: 0.05
      })

      rebuildSummary()
      const result = cohortService.getCohortVariants({
        limit: 50,
        sort_order: 'desc'
      })

      // Snapshot captures structure - detects IPC contract changes
      expect(result).toMatchSnapshot()

      // Verify basic structure expectations
      expect(result).toHaveProperty('data')
      expect(result).toHaveProperty('total_count')
      expect(Array.isArray(result.data)).toBe(true)
      expect(typeof result.total_count).toBe('number')
    })

    it('verifies offset pagination works correctly', () => {
      const caseId = insertCase('Test Case')
      for (let i = 0; i < 10; i++) {
        insertVariant(caseId, '1', 100 + i, 'A', 'G', { gene_symbol: `GENE${i}` })
      }

      rebuildSummary()
      const page1 = cohortService.getCohortVariants({ limit: 3, offset: 0 })
      expect(page1.data.length).toBe(3)
      expect(page1.total_count).toBe(10)

      const page2 = cohortService.getCohortVariants({ limit: 3, offset: 3 })
      expect(page2.data.length).toBe(3)
      expect(page2.total_count).toBe(10)

      // Different pages should have different variants
      const page1Keys = page1.data.map((v) => v.variant_key)
      const page2Keys = page2.data.map((v) => v.variant_key)
      expect(page1Keys).not.toEqual(page2Keys)
    })
  })

  describe('getCohortSummary - IPC payload structure', () => {
    it('returns expected summary structure (snapshot)', () => {
      const case1 = insertCase('Case 1')
      const case2 = insertCase('Case 2')

      insertVariant(case1, '1', 100, 'A', 'G', { gene_symbol: 'BRCA1' })
      insertVariant(case2, '1', 100, 'A', 'G', { gene_symbol: 'BRCA1' })
      insertVariant(case1, '2', 200, 'C', 'T', { gene_symbol: 'TP53' })

      rebuildSummary()
      const result = cohortService.getCohortSummary()

      // Snapshot captures structure
      expect(result).toMatchSnapshot()

      // Verify structure
      expect(result).toHaveProperty('total_cases')
      expect(result).toHaveProperty('total_variants')
      expect(result).toHaveProperty('unique_variants')
    })
  })

  describe('getCarriers - IPC payload structure', () => {
    it('returns carrier list with expected structure (snapshot)', () => {
      const case1 = insertCase('Patient A')
      const case2 = insertCase('Patient B')

      insertVariant(case1, '1', 12345, 'A', 'G', { gt_num: '0/1' })
      insertVariant(case2, '1', 12345, 'A', 'G', { gt_num: '1/1' })

      const result = cohortService.getCarriers({
        chr: '1',
        pos: 12345,
        ref: 'A',
        alt: 'G',
        variant_type: 'snv',
        genome_build: 'GRCh38'
      })

      // Snapshot captures structure
      expect(result).toMatchSnapshot()

      // Verify structure
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(2)
      expect(result[0]).toHaveProperty('case_name')
      expect(result[0]).toHaveProperty('gt_num')
    })
  })

  describe('Filter combination tests (TEST-05: mock/production parity)', () => {
    it('includes NULL gnomad_af when filter applied', () => {
      const caseId = insertCase('Test Case')

      // Variant with gnomAD AF
      insertVariant(caseId, '1', 100, 'A', 'G', { gnomad_af: 0.001 })
      // Variant with NULL gnomAD AF
      insertVariant(caseId, '2', 200, 'C', 'T', {}) // NULL gnomad_af
      // Variant with high gnomAD AF
      insertVariant(caseId, '3', 300, 'G', 'A', { gnomad_af: 0.5 })

      rebuildSummary()
      const result = cohortService.getCohortVariants({ gnomad_af_max: 0.01 })

      // NULL should be included (matches production behavior from 26-01)
      expect(result.total_count).toBe(2)
      const positions = result.data.map((v) => v.pos)
      expect(positions).toContain(100) // Low AF variant
      expect(positions).toContain(200) // NULL AF variant

      // Verify NULL handling
      const nullVariant = result.data.find((v) => v.pos === 200)
      expect(nullVariant?.gnomad_af).toBeNull()
    })

    it('includes NULL CADD when filter applied (same as gnomAD behavior)', () => {
      const caseId = insertCase('Test Case')

      // Variant with high CADD
      insertVariant(caseId, '1', 100, 'A', 'G', { cadd: 30 })
      // Variant with NULL CADD
      insertVariant(caseId, '2', 200, 'C', 'T', {}) // NULL cadd
      // Variant with low CADD
      insertVariant(caseId, '3', 300, 'G', 'A', { cadd: 5 })

      rebuildSummary()
      const result = cohortService.getCohortVariants({ cadd_min: 20 })

      // NULL should be included (same behavior as gnomAD filter)
      expect(result.total_count).toBe(2)
      const positions = result.data.map((v) => v.pos)
      expect(positions).toContain(100) // High CADD variant
      expect(positions).toContain(200) // NULL CADD variant

      // Verify NULL handling
      const nullVariant = result.data.find((v) => v.pos === 200)
      expect(nullVariant?.cadd_phred).toBeNull()
    })

    it('uses exact IN matching for ClinVar filter', () => {
      const caseId = insertCase('Test Case')

      insertVariant(caseId, '1', 100, 'A', 'G', { clinvar: 'Pathogenic' })
      insertVariant(caseId, '2', 200, 'C', 'T', { clinvar: 'Likely_pathogenic' })
      insertVariant(caseId, '3', 300, 'G', 'A', { clinvar: 'Benign' })

      rebuildSummary()
      const result = cohortService.getCohortVariants({ clinvars: ['Pathogenic'] })

      // Exact match only — should NOT match Likely_pathogenic
      expect(result.total_count).toBe(1)
      const clinvars = result.data.map((v) => v.clinvar)
      expect(clinvars).toContain('Pathogenic')
      expect(clinvars).not.toContain('Likely_pathogenic')
    })

    it('combines multiple filters correctly', () => {
      const case1 = insertCase('Case 1')
      const case2 = insertCase('Case 2')

      // Matching variant in both cases
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

      // Variant with NULL gnomAD (should be included)
      insertVariant(case1, '2', 200, 'C', 'T', {
        gene_symbol: 'BRCA1',
        consequence: 'HIGH',
        cadd: 30
      })

      // Variant with too high gnomAD (should be excluded)
      insertVariant(case1, '3', 300, 'G', 'A', {
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
        cadd_min: 20
      })

      // Should include variants at pos 100 and 200 (NULL gnomAD passes filter)
      expect(result.total_count).toBe(2)
      const positions = result.data.map((v) => v.pos)
      expect(positions).toContain(100)
      expect(positions).toContain(200)
    })
  })
})
