import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseService } from '../../../src/main/database'
import { makeVariant as _makeVariant } from '../../utils/make-variant'

/** Variant-frequency tests default to null gene_symbol/consequence */
function makeVariant(overrides: Record<string, unknown> = {}) {
  return _makeVariant({ gene_symbol: null, consequence: null, ...overrides })
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

    const freq = service.db
      .prepare(
        'SELECT case_count FROM variant_frequency WHERE chr = ? AND pos = ? AND ref = ? AND alt = ?'
      )
      .get('1', 100, 'A', 'G') as { case_count: number }
    expect(freq.case_count).toBe(1)
  })

  it('updateFrequencies increments existing counts for shared variants', () => {
    const c1 = service.cases.createCase('case-1', '/a.json', 100)
    const c2 = service.cases.createCase('case-2', '/b.json', 100)

    service.variants.insertVariantsBatch(c1, [makeVariant()])
    service.variants.updateFrequencies(c1)
    service.variants.insertVariantsBatch(c2, [makeVariant()])
    service.variants.updateFrequencies(c2)

    const freq = service.db
      .prepare(
        'SELECT case_count FROM variant_frequency WHERE chr = ? AND pos = ? AND ref = ? AND alt = ?'
      )
      .get('1', 100, 'A', 'G') as { case_count: number }
    expect(freq.case_count).toBe(2)
  })

  it('decrementFrequencies reduces case_count and removes zeros', () => {
    const c1 = service.cases.createCase('case-1', '/a.json', 100)
    service.variants.insertVariantsBatch(c1, [makeVariant()])
    service.variants.updateFrequencies(c1)

    service.variants.decrementFrequencies(c1)

    const freq = service.db
      .prepare(
        'SELECT case_count FROM variant_frequency WHERE chr = ? AND pos = ? AND ref = ? AND alt = ?'
      )
      .get('1', 100, 'A', 'G') as { case_count: number } | undefined
    expect(freq).toBeUndefined()
  })

  it('getVariants returns internal_af computed from variant_frequency', () => {
    const c1 = service.cases.createCase('case-1', '/a.json', 100)
    const c2 = service.cases.createCase('case-2', '/b.json', 100)

    service.variants.insertVariantsBatch(c1, [makeVariant({ pos: 100 })])
    service.variants.updateFrequencies(c1)
    service.variants.insertVariantsBatch(c2, [makeVariant({ pos: 200, ref: 'C', alt: 'T' })])
    service.variants.updateFrequencies(c2)

    const result = service.variants.getVariants({ case_id: c1 }, 50, 0)
    const v = result.data[0]
    expect(v.internal_af).toBeCloseTo(0.5) // 1 out of 2 total cases
  })

  it('max_internal_af filter excludes high-frequency variants', () => {
    const c1 = service.cases.createCase('case-1', '/a.json', 100)
    const c2 = service.cases.createCase('case-2', '/b.json', 100)
    const shared = makeVariant({ pos: 100 })
    const unique = makeVariant({ pos: 200, ref: 'C', alt: 'T' })

    service.variants.insertVariantsBatch(c1, [shared, unique])
    service.variants.updateFrequencies(c1)
    service.variants.insertVariantsBatch(c2, [shared])
    service.variants.updateFrequencies(c2)

    // Shared variant: 2/2 = 100%, unique: 1/2 = 50%
    // Filter max 60% should keep only the unique variant
    const result = service.variants.getVariants({ case_id: c1, max_internal_af: 0.6 }, 50, 0)
    expect(result.data).toHaveLength(1)
    expect(result.data[0].pos).toBe(200)
  })

  it('variants without frequency data pass max_internal_af filter', () => {
    const c1 = service.cases.createCase('case-1', '/a.json', 100)
    service.variants.insertVariantsBatch(c1, [makeVariant({ pos: 100 })])
    // Don't call updateFrequencies — no frequency data

    const result = service.variants.getVariants({ case_id: c1, max_internal_af: 0.01 }, 50, 0)
    // Should still return the variant (NULL-inclusive)
    expect(result.data).toHaveLength(1)
  })

  it('decrementFrequencies leaves other cases counts intact', () => {
    const c1 = service.cases.createCase('case-1', '/a.json', 100)
    const c2 = service.cases.createCase('case-2', '/b.json', 100)

    service.variants.insertVariantsBatch(c1, [makeVariant()])
    service.variants.updateFrequencies(c1)
    service.variants.insertVariantsBatch(c2, [makeVariant()])
    service.variants.updateFrequencies(c2)

    service.variants.decrementFrequencies(c1)

    const freq = service.db
      .prepare(
        'SELECT case_count FROM variant_frequency WHERE chr = ? AND pos = ? AND ref = ? AND alt = ?'
      )
      .get('1', 100, 'A', 'G') as { case_count: number }
    expect(freq.case_count).toBe(1)
  })
})
