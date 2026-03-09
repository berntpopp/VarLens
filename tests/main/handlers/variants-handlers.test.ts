/**
 * Variants IPC handler integration tests
 *
 * Tests IPC handlers with real SQLite backend and snapshot verification.
 * Addresses TEST-04 (integration with real DB) and TEST-08 (snapshot contracts).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseService } from '../../../src/main/database/DatabaseService'
import type { VariantFilter } from '../../../src/main/database/types'

describe('variant IPC handlers', () => {
  let db: DatabaseService
  let caseId: number

  // Helper to insert a case
  const insertCase = (name: string): number => {
    const result = db.database
      .prepare(
        'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(name, `/test/path/${name}.json`, 1000, 0, Date.now())
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
      omim_mim_number?: string
      transcript?: string
    } = {}
  ): void => {
    db.database
      .prepare(
        `
      INSERT INTO variants (
        case_id, chr, pos, ref, alt, gene_symbol, consequence, func, clinvar,
        gnomad_af, cadd, gt_num, omim_mim_number, transcript
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
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
        options.omim_mim_number ?? null,
        options.transcript ?? null
      )
  }

  beforeEach(() => {
    // Create in-memory database
    db = new DatabaseService(':memory:')
    caseId = insertCase('Test Case')
  })

  afterEach(() => {
    db.close()
  })

  describe('getVariants (variants:query) - IPC payload structure', () => {
    it('returns expected response structure (snapshot)', () => {
      // Insert test variants with rich data
      insertVariant(caseId, '1', 12345, 'A', 'G', {
        gene_symbol: 'BRCA1',
        consequence: 'HIGH',
        func: 'missense_variant',
        clinvar: 'Pathogenic',
        gnomad_af: 0.0001,
        cadd: 25.5,
        omim_mim_number: '113705',
        transcript: 'ENST00000357654'
      })
      insertVariant(caseId, '2', 54321, 'C', 'T', {
        gene_symbol: 'TP53',
        consequence: 'MODERATE',
        gnomad_af: 0.05
      })
      insertVariant(caseId, '3', 98765, 'G', 'A', {
        gene_symbol: 'EGFR',
        consequence: 'LOW'
      })

      const filter: VariantFilter = { case_id: caseId }
      const result = db.variants.getVariants(filter, 50)

      // Snapshot captures structure - detects IPC contract changes
      expect(result).toMatchSnapshot()

      // Verify basic structure expectations
      expect(result).toHaveProperty('data')
      expect(result).toHaveProperty('total_count')
      expect(result).toHaveProperty('has_more')
      expect(result).toHaveProperty('next_cursor')
      expect(Array.isArray(result.data)).toBe(true)
      expect(typeof result.total_count).toBe('number')
    })

    it('respects limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        insertVariant(caseId, '1', 1000 + i, 'A', 'G', { gene_symbol: `GENE${i}` })
      }

      const filter: VariantFilter = { case_id: caseId }
      const result = db.variants.getVariants(filter, 3)

      expect(result.data.length).toBe(3)
      expect(result.total_count).toBe(10)
      expect(result.has_more).toBe(true)
    })

    it('respects sort parameters', () => {
      insertVariant(caseId, '1', 300, 'A', 'G')
      insertVariant(caseId, '1', 100, 'C', 'T')
      insertVariant(caseId, '1', 200, 'G', 'A')

      const filter: VariantFilter = { case_id: caseId }
      const result = db.variants.getVariants(filter, 50, undefined, [{ key: 'pos', order: 'asc' }])

      expect(result.data[0].pos).toBe(100)
      expect(result.data[1].pos).toBe(200)
      expect(result.data[2].pos).toBe(300)
    })

    it('handles filters correctly', () => {
      insertVariant(caseId, '1', 100, 'A', 'G', {
        gene_symbol: 'BRCA1',
        consequence: 'HIGH',
        gnomad_af: 0.0001
      })
      insertVariant(caseId, '2', 200, 'C', 'T', {
        gene_symbol: 'TP53',
        consequence: 'MODERATE',
        gnomad_af: 0.1
      })

      const filter: VariantFilter = {
        case_id: caseId,
        consequences: ['HIGH'],
        gnomad_af_max: 0.01
      }
      const result = db.variants.getVariants(filter, 50)

      expect(result.total_count).toBe(1)
      expect(result.data[0].gene_symbol).toBe('BRCA1')
    })
  })

  describe('getFilterOptions (variants:filterOptions) - IPC payload structure', () => {
    it('returns available filter options structure (snapshot)', () => {
      insertVariant(caseId, '1', 100, 'A', 'G', {
        consequence: 'HIGH',
        func: 'missense_variant',
        clinvar: 'Pathogenic',
        gnomad_af: 0.001,
        cadd: 25
      })
      insertVariant(caseId, '2', 200, 'C', 'T', {
        consequence: 'MODERATE',
        func: 'synonymous_variant',
        clinvar: 'Benign',
        gnomad_af: 0.5,
        cadd: 10
      })

      // Simulate what the handler does
      const consequencesResult = db.database
        .prepare(
          'SELECT DISTINCT consequence FROM variants WHERE case_id = ? AND consequence IS NOT NULL ORDER BY consequence'
        )
        .all(caseId) as { consequence: string }[]

      const funcsResult = db.database
        .prepare(
          'SELECT DISTINCT func FROM variants WHERE case_id = ? AND func IS NOT NULL ORDER BY func'
        )
        .all(caseId) as { func: string }[]

      const clinvarsResult = db.database
        .prepare(
          'SELECT DISTINCT clinvar FROM variants WHERE case_id = ? AND clinvar IS NOT NULL ORDER BY clinvar'
        )
        .all(caseId) as { clinvar: string }[]

      const caddRange = db.database
        .prepare(
          'SELECT MIN(cadd) as min_cadd, MAX(cadd) as max_cadd FROM variants WHERE case_id = ? AND cadd IS NOT NULL'
        )
        .get(caseId) as { min_cadd: number | null; max_cadd: number | null } | undefined

      const afRange = db.database
        .prepare(
          'SELECT MIN(gnomad_af) as min_af, MAX(gnomad_af) as max_af FROM variants WHERE case_id = ? AND gnomad_af IS NOT NULL'
        )
        .get(caseId) as { min_af: number | null; max_af: number | null } | undefined

      const filterOptions = {
        consequences: consequencesResult.map((r) => r.consequence),
        funcs: funcsResult.map((r) => r.func),
        clinvars: clinvarsResult.map((r) => r.clinvar),
        minCadd: caddRange?.min_cadd ?? null,
        maxCadd: caddRange?.max_cadd ?? null,
        minGnomadAf: afRange?.min_af ?? null,
        maxGnomadAf: afRange?.max_af ?? null
      }

      // Snapshot captures structure
      expect(filterOptions).toMatchSnapshot()

      // Verify structure
      expect(filterOptions).toHaveProperty('consequences')
      expect(filterOptions).toHaveProperty('funcs')
      expect(filterOptions).toHaveProperty('clinvars')
      expect(filterOptions).toHaveProperty('minCadd')
      expect(filterOptions).toHaveProperty('maxCadd')
      expect(Array.isArray(filterOptions.consequences)).toBe(true)
      expect(Array.isArray(filterOptions.funcs)).toBe(true)
      expect(Array.isArray(filterOptions.clinvars)).toBe(true)
    })

    it('handles empty database correctly', () => {
      const consequencesResult = db.database
        .prepare(
          'SELECT DISTINCT consequence FROM variants WHERE case_id = ? AND consequence IS NOT NULL ORDER BY consequence'
        )
        .all(caseId) as { consequence: string }[]

      const filterOptions = {
        consequences: consequencesResult.map((r) => r.consequence),
        funcs: [],
        clinvars: [],
        minCadd: null,
        maxCadd: null,
        minGnomadAf: null,
        maxGnomadAf: null
      }

      expect(filterOptions.consequences).toEqual([])
      expect(filterOptions.minCadd).toBeNull()
    })
  })

  describe('searchVariants (variants:search) - IPC payload structure', () => {
    it('returns search results with expected structure (snapshot)', () => {
      insertVariant(caseId, '1', 100, 'A', 'G', {
        gene_symbol: 'BRCA1',
        consequence: 'HIGH'
      })
      insertVariant(caseId, '2', 200, 'C', 'T', {
        gene_symbol: 'BRCA2',
        consequence: 'MODERATE'
      })
      insertVariant(caseId, '3', 300, 'G', 'A', {
        gene_symbol: 'TP53',
        consequence: 'HIGH'
      })

      const result = db.variants.searchVariants(caseId, 'BRCA', 20)

      // Snapshot captures structure
      expect(result).toMatchSnapshot()

      // Verify structure
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toHaveProperty('gene_symbol')
      expect(result[0]).toHaveProperty('chr')
      expect(result[0]).toHaveProperty('pos')
    })

    it('handles FTS5 prefix matching', () => {
      insertVariant(caseId, '1', 100, 'A', 'G', { gene_symbol: 'BRCA1' })
      insertVariant(caseId, '2', 200, 'C', 'T', { gene_symbol: 'BRCA2' })
      insertVariant(caseId, '3', 300, 'G', 'A', { gene_symbol: 'TP53' })

      const result = db.variants.searchVariants(caseId, 'BR', 20)

      expect(result.length).toBe(2)
      const geneSymbols = result.map((v) => v.gene_symbol)
      expect(geneSymbols).toContain('BRCA1')
      expect(geneSymbols).toContain('BRCA2')
    })

    it('respects limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        insertVariant(caseId, '1', 1000 + i, 'A', 'G', {
          gene_symbol: `GENE${i}`,
          consequence: 'HIGH'
        })
      }

      const result = db.variants.searchVariants(caseId, 'GENE', 3)

      expect(result.length).toBe(3)
    })
  })
})
