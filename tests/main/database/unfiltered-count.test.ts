import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseService } from '../../../src/main/database'
import type { Variant } from '../../../src/main/database/types'

function createTestCase(db: DatabaseService, name: string): number {
  return db.cases.createCase(name, `/path/to/${name}.vcf`, 1024)
}

function makeVariants(count: number): Omit<Variant, 'id' | 'case_id'>[] {
  return Array.from({ length: count }, (_, i) => ({
    chr: String((i % 22) + 1),
    pos: 10000 + i * 100,
    ref: 'A',
    alt: 'G',
    gene_symbol: i % 2 === 0 ? 'BRCA1' : 'TP53',
    consequence: i % 2 === 0 ? 'HIGH' : 'LOW',
    gnomad_af: (i + 1) * 0.01,
    cadd: 10 + (i % 30),
    clinvar: i % 2 === 0 ? 'pathogenic' : null,
    omim_mim_number: null,
    func: null,
    qual: null,
    hpo_sim_score: null,
    transcript: null,
    cdna: null,
    aa_change: null,
    moi: null,
    gq: null,
    dp: null,
    ad_ref: null,
    ad_alt: null,
    ab: null,
    filter: null,
    info_json: null,
    source_format: null
  }))
}

describe('getVariants — includeUnfilteredCount', () => {
  let db: DatabaseService
  let caseId: number

  beforeEach(() => {
    db = new DatabaseService(':memory:')
    caseId = createTestCase(db, 'test-case')
    db.variants.insertVariantsBatch(caseId, makeVariants(10))
  })

  afterEach(() => {
    db.close()
  })

  it('does NOT include unfiltered_count when flag is false (default)', () => {
    const result = db.variants.getVariants({ case_id: caseId }, 50)
    expect('unfiltered_count' in result).toBe(false)
  })

  it('does NOT include unfiltered_count when flag is undefined', () => {
    const result = db.variants.getVariants(
      { case_id: caseId },
      50,
      0,
      undefined,
      undefined,
      undefined
    )
    expect('unfiltered_count' in result).toBe(false)
  })

  it('includes unfiltered_count when flag is true', () => {
    const result = db.variants.getVariants({ case_id: caseId }, 50, 0, undefined, undefined, true)
    expect(result.unfiltered_count).toBeDefined()
    expect(result.unfiltered_count).toBe(10)
  })

  it('unfiltered_count equals total variants for case when no filter is applied', () => {
    const result = db.variants.getVariants({ case_id: caseId }, 50, 0, undefined, undefined, true)
    expect(result.unfiltered_count).toBe(result.total_count)
    expect(result.unfiltered_count).toBe(10)
  })

  it('unfiltered_count differs from total_count when filters reduce the result set', () => {
    // Filter to only HIGH consequence — 5 of 10 variants match (even indices)
    const result = db.variants.getVariants(
      { case_id: caseId, consequence: 'HIGH' },
      50,
      0,
      undefined,
      undefined,
      true
    )
    expect(result.total_count).toBeLessThan(10)
    expect(result.unfiltered_count).toBe(10)
    expect(result.unfiltered_count).not.toBe(result.total_count)
  })

  it('unfiltered_count is specific to the case (ignores other cases)', () => {
    const caseId2 = createTestCase(db, 'other-case')
    db.variants.insertVariantsBatch(caseId2, makeVariants(3))

    const result = db.variants.getVariants({ case_id: caseId }, 50, 0, undefined, undefined, true)
    // Should only count variants from caseId (10), not from caseId2 (3)
    expect(result.unfiltered_count).toBe(10)
  })
})
