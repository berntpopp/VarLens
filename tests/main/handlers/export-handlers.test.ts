/**
 * Export functionality tests
 *
 * Tests the underlying data methods used by export IPC handlers.
 * Since export handlers use Electron dialogs (not testable in unit tests),
 * we test the repository methods (getAllVariantsForExport) directly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseService } from '../../../src/main/database/DatabaseService'
import type { VariantFilter } from '../../../src/main/database/types'

describe('export data methods', () => {
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
      transcript?: string
      cdna?: string
      aa_change?: string
      qual?: number
      hpo_sim_score?: number
      moi?: string
    } = {}
  ): void => {
    db.database
      .prepare(
        `
      INSERT INTO variants (
        case_id, chr, pos, ref, alt, gene_symbol, consequence, func, clinvar,
        gnomad_af, cadd, gt_num, transcript, cdna, aa_change, qual, hpo_sim_score, moi
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        options.transcript ?? null,
        options.cdna ?? null,
        options.aa_change ?? null,
        options.qual ?? null,
        options.hpo_sim_score ?? null,
        options.moi ?? null
      )
  }

  beforeEach(() => {
    db = new DatabaseService(':memory:')
    caseId = insertCase('Test Case')
  })

  afterEach(() => {
    db.close()
  })

  describe('getAllVariantsForExport - no filters', () => {
    it('should export all variants for a case', () => {
      insertVariant(caseId, '1', 12345, 'A', 'G', {
        gene_symbol: 'BRCA1',
        consequence: 'HIGH',
        func: 'missense_variant'
      })
      insertVariant(caseId, '2', 54321, 'C', 'T', {
        gene_symbol: 'TP53',
        consequence: 'MODERATE',
        func: 'synonymous_variant'
      })
      insertVariant(caseId, '3', 98765, 'G', 'A', {
        gene_symbol: 'EGFR',
        consequence: 'LOW',
        func: 'intron_variant'
      })

      const filter: VariantFilter = { case_id: caseId }
      const result = db.variants.getAllVariantsForExport(filter)

      expect(result).toHaveLength(3)
      // Results should be ordered by chr, pos
      expect(result[0].chr).toBe('1')
      expect(result[1].chr).toBe('2')
      expect(result[2].chr).toBe('3')
    })

    it('should not include variants from other cases', () => {
      const otherCaseId = insertCase('Other Case')

      insertVariant(caseId, '1', 100, 'A', 'G', { gene_symbol: 'BRCA1' })
      insertVariant(otherCaseId, '2', 200, 'C', 'T', { gene_symbol: 'TP53' })

      const filter: VariantFilter = { case_id: caseId }
      const result = db.variants.getAllVariantsForExport(filter)

      expect(result).toHaveLength(1)
      expect(result[0].gene_symbol).toBe('BRCA1')
    })
  })

  describe('getAllVariantsForExport - correct columns', () => {
    it('should return variants with all export-relevant columns', () => {
      insertVariant(caseId, '1', 12345, 'A', 'G', {
        gene_symbol: 'BRCA1',
        consequence: 'HIGH',
        func: 'missense_variant',
        clinvar: 'Pathogenic',
        gnomad_af: 0.0001,
        cadd: 25.5,
        gt_num: '0/1',
        transcript: 'ENST00000357654',
        cdna: 'c.5266dupC',
        aa_change: 'p.Gln1756Profs*74',
        qual: 99,
        hpo_sim_score: 0.8765,
        moi: 'AD'
      })

      const filter: VariantFilter = { case_id: caseId }
      const result = db.variants.getAllVariantsForExport(filter)

      expect(result).toHaveLength(1)
      const variant = result[0]

      // Verify all columns used by EXPORT_COLUMNS are present
      expect(variant.chr).toBe('1')
      expect(variant.pos).toBe(12345)
      expect(variant.ref).toBe('A')
      expect(variant.alt).toBe('G')
      expect(variant.gt_num).toBe('0/1')
      expect(variant.gene_symbol).toBe('BRCA1')
      expect(variant.func).toBe('missense_variant')
      expect(variant.consequence).toBe('HIGH')
      expect(variant.transcript).toBe('ENST00000357654')
      expect(variant.cdna).toBe('c.5266dupC')
      expect(variant.aa_change).toBe('p.Gln1756Profs*74')
      expect(variant.gnomad_af).toBe(0.0001)
      expect(variant.cadd).toBe(25.5)
      expect(variant.qual).toBe(99)
      expect(variant.clinvar).toBe('Pathogenic')
      expect(variant.hpo_sim_score).toBe(0.8765)
      expect(variant.moi).toBe('AD')
    })

    it('should handle null optional columns gracefully', () => {
      insertVariant(caseId, '1', 100, 'A', 'G')

      const filter: VariantFilter = { case_id: caseId }
      const result = db.variants.getAllVariantsForExport(filter)

      expect(result).toHaveLength(1)
      const variant = result[0]

      expect(variant.chr).toBe('1')
      expect(variant.pos).toBe(100)
      expect(variant.ref).toBe('A')
      expect(variant.alt).toBe('G')
      expect(variant.gene_symbol).toBeNull()
      expect(variant.consequence).toBeNull()
      expect(variant.gnomad_af).toBeNull()
      expect(variant.cadd).toBeNull()
      expect(variant.clinvar).toBeNull()
    })
  })

  describe('getAllVariantsForExport - with filters', () => {
    beforeEach(() => {
      insertVariant(caseId, '1', 100, 'A', 'G', {
        gene_symbol: 'BRCA1',
        consequence: 'HIGH',
        func: 'missense_variant',
        clinvar: 'Pathogenic',
        gnomad_af: 0.0001,
        cadd: 25.5
      })
      insertVariant(caseId, '2', 200, 'C', 'T', {
        gene_symbol: 'TP53',
        consequence: 'MODERATE',
        func: 'synonymous_variant',
        clinvar: 'Benign',
        gnomad_af: 0.1,
        cadd: 10
      })
      insertVariant(caseId, '3', 300, 'G', 'A', {
        gene_symbol: 'EGFR',
        consequence: 'LOW',
        func: 'intron_variant',
        gnomad_af: 0.5,
        cadd: 5
      })
    })

    it('should filter by gene symbol', () => {
      const filter: VariantFilter = { case_id: caseId, gene_symbol: 'BRCA1' }
      const result = db.variants.getAllVariantsForExport(filter)

      expect(result).toHaveLength(1)
      expect(result[0].gene_symbol).toBe('BRCA1')
    })

    it('should filter by consequence', () => {
      const filter: VariantFilter = { case_id: caseId, consequences: ['HIGH'] }
      const result = db.variants.getAllVariantsForExport(filter)

      expect(result).toHaveLength(1)
      expect(result[0].consequence).toBe('HIGH')
    })

    it('should filter by multiple consequences', () => {
      const filter: VariantFilter = { case_id: caseId, consequences: ['HIGH', 'MODERATE'] }
      const result = db.variants.getAllVariantsForExport(filter)

      expect(result).toHaveLength(2)
      const consequences = result.map((v) => v.consequence)
      expect(consequences).toContain('HIGH')
      expect(consequences).toContain('MODERATE')
    })

    it('should filter by gnomad_af_max', () => {
      const filter: VariantFilter = { case_id: caseId, gnomad_af_max: 0.01 }
      const result = db.variants.getAllVariantsForExport(filter)

      expect(result).toHaveLength(1)
      expect(result[0].gene_symbol).toBe('BRCA1')
    })

    it('should filter by cadd_min', () => {
      const filter: VariantFilter = { case_id: caseId, cadd_min: 20 }
      const result = db.variants.getAllVariantsForExport(filter)

      expect(result).toHaveLength(1)
      expect(result[0].gene_symbol).toBe('BRCA1')
    })

    it('should filter by clinvar values', () => {
      const filter: VariantFilter = { case_id: caseId, clinvars: ['Pathogenic'] }
      const result = db.variants.getAllVariantsForExport(filter)

      expect(result).toHaveLength(1)
      expect(result[0].clinvar).toBe('Pathogenic')
    })

    it('should filter by function types', () => {
      const filter: VariantFilter = {
        case_id: caseId,
        funcs: ['missense_variant', 'intron_variant']
      }
      const result = db.variants.getAllVariantsForExport(filter)

      expect(result).toHaveLength(2)
      const funcs = result.map((v) => v.func)
      expect(funcs).toContain('missense_variant')
      expect(funcs).toContain('intron_variant')
    })

    it('should combine multiple filters', () => {
      const filter: VariantFilter = {
        case_id: caseId,
        consequences: ['HIGH', 'MODERATE'],
        gnomad_af_max: 0.01
      }
      const result = db.variants.getAllVariantsForExport(filter)

      expect(result).toHaveLength(1)
      expect(result[0].gene_symbol).toBe('BRCA1')
    })
  })

  describe('getAllVariantsForExport - empty case', () => {
    it('should return empty array for case with no variants', () => {
      const filter: VariantFilter = { case_id: caseId }
      const result = db.variants.getAllVariantsForExport(filter)

      expect(result).toEqual([])
    })

    it('should return empty array for non-existent case', () => {
      const filter: VariantFilter = { case_id: 99999 }
      const result = db.variants.getAllVariantsForExport(filter)

      expect(result).toEqual([])
    })

    it('should return empty array when filters exclude all variants', () => {
      insertVariant(caseId, '1', 100, 'A', 'G', {
        gene_symbol: 'BRCA1',
        consequence: 'HIGH',
        gnomad_af: 0.1
      })

      const filter: VariantFilter = {
        case_id: caseId,
        gnomad_af_max: 0.001,
        consequences: ['LOW']
      }
      const result = db.variants.getAllVariantsForExport(filter)

      expect(result).toEqual([])
    })
  })

  describe('getAllVariantsForExport - ordering', () => {
    it('should return variants ordered by chr then pos', () => {
      insertVariant(caseId, '2', 500, 'A', 'G')
      insertVariant(caseId, '1', 300, 'C', 'T')
      insertVariant(caseId, '1', 100, 'G', 'A')
      insertVariant(caseId, '3', 200, 'T', 'C')

      const filter: VariantFilter = { case_id: caseId }
      const result = db.variants.getAllVariantsForExport(filter)

      expect(result).toHaveLength(4)
      expect(result[0].chr).toBe('1')
      expect(result[0].pos).toBe(100)
      expect(result[1].chr).toBe('1')
      expect(result[1].pos).toBe(300)
      expect(result[2].chr).toBe('2')
      expect(result[2].pos).toBe(500)
      expect(result[3].chr).toBe('3')
      expect(result[3].pos).toBe(200)
    })
  })
})
