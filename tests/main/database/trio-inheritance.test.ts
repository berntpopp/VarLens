import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseService } from '../../../src/main/database'
import { makeVariant } from '../../utils/make-variant'

describe('Trio inheritance filters', () => {
  let service: DatabaseService
  let probandId: number
  let fatherId: number
  let motherId: number
  let groupId: number

  beforeEach(() => {
    service = new DatabaseService(':memory:')

    probandId = service.cases.createCase('proband', '/p.json', 100)
    fatherId = service.cases.createCase('father', '/f.json', 100)
    motherId = service.cases.createCase('mother', '/m.json', 100)

    const group = service.analysisGroups.createGroup('FAM001', 'family')
    groupId = group.id
    service.analysisGroups.addMember(groupId, probandId, 'proband', 'affected')
    service.analysisGroups.addMember(groupId, fatherId, 'father', 'unaffected')
    service.analysisGroups.addMember(groupId, motherId, 'mother', 'unaffected')
  })

  afterEach(() => {
    service.close()
  })

  describe('de_novo', () => {
    it('finds variants in proband absent in both parents', () => {
      service.variants.insertVariantsBatch(probandId, [
        makeVariant({ gt_num: '0/1', pos: 100 }),
        makeVariant({ gt_num: '0/1', pos: 200 })
      ])
      // Father has variant at pos 200
      service.variants.insertVariantsBatch(fatherId, [makeVariant({ gt_num: '0/1', pos: 200 })])
      // Mother has no variants at these positions

      const result = service.variants.getVariants(
        {
          case_id: probandId,
          inheritance_modes: ['de_novo'],
          analysis_group_id: groupId
        },
        50,
        0
      )
      expect(result.data).toHaveLength(1)
      expect(result.data[0].pos).toBe(100)
    })

    it('includes variant when parent has ref genotype at same position', () => {
      service.variants.insertVariantsBatch(probandId, [makeVariant({ gt_num: '0/1', pos: 100 })])
      service.variants.insertVariantsBatch(fatherId, [makeVariant({ gt_num: '0/0', pos: 100 })])

      const result = service.variants.getVariants(
        {
          case_id: probandId,
          inheritance_modes: ['de_novo'],
          analysis_group_id: groupId
        },
        50,
        0
      )
      expect(result.data).toHaveLength(1)
    })

    it('excludes variant when parent carries the alt allele', () => {
      service.variants.insertVariantsBatch(probandId, [makeVariant({ gt_num: '0/1', pos: 100 })])
      service.variants.insertVariantsBatch(motherId, [makeVariant({ gt_num: '0/1', pos: 100 })])

      const result = service.variants.getVariants(
        {
          case_id: probandId,
          inheritance_modes: ['de_novo'],
          analysis_group_id: groupId
        },
        50,
        0
      )
      expect(result.data).toHaveLength(0)
    })
  })

  describe('autosomal_recessive', () => {
    it('finds hom variants where parents are not hom', () => {
      service.variants.insertVariantsBatch(probandId, [
        makeVariant({ gt_num: '1/1', pos: 100 }),
        makeVariant({ gt_num: '0/1', pos: 200 })
      ])
      service.variants.insertVariantsBatch(fatherId, [makeVariant({ gt_num: '0/1', pos: 100 })])
      service.variants.insertVariantsBatch(motherId, [makeVariant({ gt_num: '0/1', pos: 100 })])

      const result = service.variants.getVariants(
        {
          case_id: probandId,
          inheritance_modes: ['autosomal_recessive'],
          analysis_group_id: groupId
        },
        50,
        0
      )
      expect(result.data).toHaveLength(1)
      expect(result.data[0].gt_num).toBe('1/1')
    })

    it('excludes hom variant when a parent is also hom', () => {
      service.variants.insertVariantsBatch(probandId, [makeVariant({ gt_num: '1/1', pos: 100 })])
      service.variants.insertVariantsBatch(fatherId, [makeVariant({ gt_num: '1/1', pos: 100 })])

      const result = service.variants.getVariants(
        {
          case_id: probandId,
          inheritance_modes: ['autosomal_recessive'],
          analysis_group_id: groupId
        },
        50,
        0
      )
      expect(result.data).toHaveLength(0)
    })
  })

  describe('compound_het', () => {
    it('finds gene with het variants from different parents', () => {
      service.variants.insertVariantsBatch(probandId, [
        makeVariant({ gt_num: '0/1', pos: 100, gene_symbol: 'GENE1' }),
        makeVariant({ gt_num: '0/1', pos: 200, gene_symbol: 'GENE1' }),
        makeVariant({ gt_num: '0/1', pos: 300, gene_symbol: 'GENE2' })
      ])
      // Father contributes variant at pos 100
      service.variants.insertVariantsBatch(fatherId, [
        makeVariant({ gt_num: '0/1', pos: 100, gene_symbol: 'GENE1' })
      ])
      // Mother contributes variant at pos 200
      service.variants.insertVariantsBatch(motherId, [
        makeVariant({ gt_num: '0/1', pos: 200, gene_symbol: 'GENE1' })
      ])

      const result = service.variants.getVariants(
        {
          case_id: probandId,
          inheritance_modes: ['compound_het'],
          analysis_group_id: groupId
        },
        50,
        0
      )
      expect(result.data).toHaveLength(2)
      expect(result.data.every((v) => v.gene_symbol === 'GENE1')).toBe(true)
    })

    it('excludes gene when both variants come from same parent', () => {
      service.variants.insertVariantsBatch(probandId, [
        makeVariant({ gt_num: '0/1', pos: 100, gene_symbol: 'GENE1' }),
        makeVariant({ gt_num: '0/1', pos: 200, gene_symbol: 'GENE1' })
      ])
      // Father has both variants (cis, not compound het)
      service.variants.insertVariantsBatch(fatherId, [
        makeVariant({ gt_num: '0/1', pos: 100, gene_symbol: 'GENE1' }),
        makeVariant({ gt_num: '0/1', pos: 200, gene_symbol: 'GENE1' })
      ])
      // Mother has neither

      const result = service.variants.getVariants(
        {
          case_id: probandId,
          inheritance_modes: ['compound_het'],
          analysis_group_id: groupId
        },
        50,
        0
      )
      // Should exclude - mother doesn't contribute any variant
      expect(result.data).toHaveLength(0)
    })
  })

  describe('combined modes', () => {
    it('de_novo + autosomal_recessive returns union of both', () => {
      service.variants.insertVariantsBatch(probandId, [
        makeVariant({ gt_num: '0/1', pos: 100 }), // de novo candidate
        makeVariant({ gt_num: '1/1', pos: 200 }) // AR candidate
      ])
      // Parents: no variant at pos 100, carrier at pos 200
      service.variants.insertVariantsBatch(fatherId, [makeVariant({ gt_num: '0/1', pos: 200 })])
      service.variants.insertVariantsBatch(motherId, [makeVariant({ gt_num: '0/1', pos: 200 })])

      const result = service.variants.getVariants(
        {
          case_id: probandId,
          inheritance_modes: ['de_novo', 'autosomal_recessive'],
          analysis_group_id: groupId
        },
        50,
        0
      )
      expect(result.data).toHaveLength(2)
    })
  })
})
