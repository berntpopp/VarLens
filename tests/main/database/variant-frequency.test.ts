import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseService } from '../../../src/main/database'

function makeVariant(overrides: Record<string, unknown> = {}) {
  return {
    chr: '1', pos: 100, ref: 'A', alt: 'G',
    gene_symbol: null, consequence: null, gnomad_af: null, cadd: null,
    clinvar: null, gt_num: '0/1', func: null, qual: null,
    hpo_sim_score: null, transcript: null, cdna: null,
    aa_change: null, moi: null, omim_mim_number: null,
    ...overrides
  }
}

describe('VariantRepository — variant frequency', () => {
  let service: DatabaseService

  beforeEach(() => {
    service = new DatabaseService(':memory:')
  })

  afterEach(() => {
    service.close()
  })

  it('updateFrequencies increments case_count for imported variants', () => {
    const caseId = service.cases.createCase('case-1', '/path/a.json', 100)
    service.variants.insertVariantsBatch(caseId, [
      makeVariant({ pos: 100 }),
      makeVariant({ pos: 200, ref: 'C', alt: 'T' })
    ])
    service.variants.updateFrequencies(caseId)

    const freq = service.db.prepare(
      'SELECT case_count FROM variant_frequency WHERE chr = ? AND pos = ? AND ref = ? AND alt = ?'
    ).get('1', 100, 'A', 'G') as { case_count: number }
    expect(freq.case_count).toBe(1)
  })

  it('updateFrequencies increments existing counts for shared variants', () => {
    const c1 = service.cases.createCase('case-1', '/a.json', 100)
    const c2 = service.cases.createCase('case-2', '/b.json', 100)

    service.variants.insertVariantsBatch(c1, [makeVariant()])
    service.variants.updateFrequencies(c1)
    service.variants.insertVariantsBatch(c2, [makeVariant()])
    service.variants.updateFrequencies(c2)

    const freq = service.db.prepare(
      'SELECT case_count FROM variant_frequency WHERE chr = ? AND pos = ? AND ref = ? AND alt = ?'
    ).get('1', 100, 'A', 'G') as { case_count: number }
    expect(freq.case_count).toBe(2)
  })

  it('decrementFrequencies reduces case_count and removes zeros', () => {
    const c1 = service.cases.createCase('case-1', '/a.json', 100)
    service.variants.insertVariantsBatch(c1, [makeVariant()])
    service.variants.updateFrequencies(c1)

    service.variants.decrementFrequencies(c1)

    const freq = service.db.prepare(
      'SELECT case_count FROM variant_frequency WHERE chr = ? AND pos = ? AND ref = ? AND alt = ?'
    ).get('1', 100, 'A', 'G') as { case_count: number } | undefined
    expect(freq).toBeUndefined()
  })

  it('decrementFrequencies leaves other cases counts intact', () => {
    const c1 = service.cases.createCase('case-1', '/a.json', 100)
    const c2 = service.cases.createCase('case-2', '/b.json', 100)

    service.variants.insertVariantsBatch(c1, [makeVariant()])
    service.variants.updateFrequencies(c1)
    service.variants.insertVariantsBatch(c2, [makeVariant()])
    service.variants.updateFrequencies(c2)

    service.variants.decrementFrequencies(c1)

    const freq = service.db.prepare(
      'SELECT case_count FROM variant_frequency WHERE chr = ? AND pos = ? AND ref = ? AND alt = ?'
    ).get('1', 100, 'A', 'G') as { case_count: number }
    expect(freq.case_count).toBe(1)
  })
})
