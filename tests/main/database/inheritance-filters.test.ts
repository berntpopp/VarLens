import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseService } from '../../../src/main/database'
import { makeVariant } from '../../utils/make-variant'

describe('Solo inheritance filters', () => {
  let service: DatabaseService

  beforeEach(() => {
    service = new DatabaseService(':memory:')
  })

  afterEach(() => {
    service.close()
  })

  it('homozygous filter returns only 1/1 variants', () => {
    const caseId = service.cases.createCase('test', '/a.json', 100)
    service.variants.insertVariantsBatch(caseId, [
      makeVariant({ gt_num: '1/1', pos: 100 }),
      makeVariant({ gt_num: '0/1', pos: 200 }),
      makeVariant({ gt_num: '0/0', pos: 300 })
    ])

    const result = service.variants.getVariants(
      { case_id: caseId, inheritance_modes: ['homozygous'] },
      50,
      0
    )
    expect(result.data).toHaveLength(1)
    expect(result.data[0].gt_num).toBe('1/1')
  })

  it('heterozygous filter returns only 0/1 variants', () => {
    const caseId = service.cases.createCase('test', '/a.json', 100)
    service.variants.insertVariantsBatch(caseId, [
      makeVariant({ gt_num: '1/1', pos: 100 }),
      makeVariant({ gt_num: '0/1', pos: 200 }),
      makeVariant({ gt_num: '0/0', pos: 300 })
    ])

    const result = service.variants.getVariants(
      { case_id: caseId, inheritance_modes: ['heterozygous'] },
      50,
      0
    )
    expect(result.data).toHaveLength(1)
    expect(result.data[0].gt_num).toBe('0/1')
  })

  it('x_hemizygous filter returns chrX hom variants', () => {
    const caseId = service.cases.createCase('test', '/a.json', 100)
    service.variants.insertVariantsBatch(caseId, [
      makeVariant({ chr: 'X', gt_num: '1/1', pos: 5000000 }),
      makeVariant({ chr: 'X', gt_num: '0/1', pos: 5000100 }),
      makeVariant({ chr: '1', gt_num: '1/1', pos: 100 })
    ])

    const result = service.variants.getVariants(
      { case_id: caseId, inheritance_modes: ['x_hemizygous'] },
      50,
      0
    )
    expect(result.data).toHaveLength(1)
    expect(result.data[0].chr).toBe('X')
    expect(result.data[0].gt_num).toBe('1/1')
  })

  it('candidate_compound_het returns genes with 2+ het variants', () => {
    const caseId = service.cases.createCase('test', '/a.json', 100)
    service.variants.insertVariantsBatch(caseId, [
      makeVariant({ gt_num: '0/1', pos: 100, gene_symbol: 'BRCA1' }),
      makeVariant({ gt_num: '0/1', pos: 200, gene_symbol: 'BRCA1' }),
      makeVariant({ gt_num: '0/1', pos: 300, gene_symbol: 'TP53' })
    ])

    const result = service.variants.getVariants(
      { case_id: caseId, inheritance_modes: ['candidate_compound_het'] },
      50,
      0
    )
    expect(result.data).toHaveLength(2)
    expect(result.data.every((v) => v.gene_symbol === 'BRCA1')).toBe(true)
  })

  it('multiple modes combine with OR logic', () => {
    const caseId = service.cases.createCase('test', '/a.json', 100)
    service.variants.insertVariantsBatch(caseId, [
      makeVariant({ gt_num: '1/1', pos: 100 }),
      makeVariant({ gt_num: '0/1', pos: 200 }),
      makeVariant({ gt_num: '0/0', pos: 300 })
    ])

    const result = service.variants.getVariants(
      { case_id: caseId, inheritance_modes: ['homozygous', 'heterozygous'] },
      50,
      0
    )
    expect(result.data).toHaveLength(2)
  })

  it('inheritance filter combines with other filters', () => {
    const caseId = service.cases.createCase('test', '/a.json', 100)
    service.variants.insertVariantsBatch(caseId, [
      makeVariant({ gt_num: '0/1', pos: 100, gene_symbol: 'BRCA1' }),
      makeVariant({ gt_num: '0/1', pos: 200, gene_symbol: 'TP53' })
    ])

    const result = service.variants.getVariants(
      { case_id: caseId, inheritance_modes: ['heterozygous'], gene_symbol: 'BRCA1' },
      50,
      0
    )
    expect(result.data).toHaveLength(1)
    expect(result.data[0].gene_symbol).toBe('BRCA1')
  })
})
