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

  describe('autosomal_recessive — parental carrier status (issue #518)', () => {
    const recessive = (group = groupId): number =>
      service.variants.getVariants(
        {
          case_id: probandId,
          inheritance_modes: ['autosomal_recessive'],
          analysis_group_id: group
        },
        50,
        0
      ).data.length

    beforeEach(() => {
      service.variants.insertVariantsBatch(probandId, [makeVariant({ gt_num: '1/1', pos: 100 })])
    })

    it('passes with two het parents, an assumed-het parent included', () => {
      service.variants.insertVariantsBatch(fatherId, [makeVariant({ gt_num: '0/1', pos: 100 })])
      service.variants.insertVariantsBatch(motherId, [makeVariant({ gt_num: './1', pos: 100 })])
      expect(recessive()).toBe(1)
    })

    it('fails when a parent has a reference call', () => {
      service.variants.insertVariantsBatch(fatherId, [makeVariant({ gt_num: '0/1', pos: 100 })])
      service.variants.insertVariantsBatch(motherId, [makeVariant({ gt_num: '0/0', pos: 100 })])
      expect(recessive()).toBe(0)
    })

    it('fails when a parent in the group has no row at the variant', () => {
      service.variants.insertVariantsBatch(fatherId, [makeVariant({ gt_num: '0/1', pos: 100 })])
      expect(recessive()).toBe(0)
    })

    it('keeps the variant when a parent has an uncalled genotype', () => {
      service.variants.insertVariantsBatch(fatherId, [makeVariant({ gt_num: '0/1', pos: 100 })])
      service.variants.insertVariantsBatch(motherId, [makeVariant({ gt_num: './.', pos: 100 })])
      expect(recessive()).toBe(1)
    })

    it('fails when a parent has a het and a hom row: the highest dosage wins', () => {
      service.variants.insertVariantsBatch(fatherId, [makeVariant({ gt_num: '0/1', pos: 100 })])
      service.variants.insertVariantsBatch(motherId, [
        makeVariant({ gt_num: '0/1', pos: 100 }),
        makeVariant({ gt_num: '1/1', pos: 100, transcript: 'NM_OTHER.1' })
      ])
      expect(recessive()).toBe(0)
    })

    it('a duo constrains only the parent it has', () => {
      const duo = service.analysisGroups.createGroup('DUO', 'family').id
      service.analysisGroups.addMember(duo, probandId, 'proband', 'affected')
      service.analysisGroups.addMember(duo, fatherId, 'father', 'unaffected')
      expect(recessive(duo)).toBe(0)
      service.variants.insertVariantsBatch(fatherId, [makeVariant({ gt_num: '0/1', pos: 100 })])
      expect(recessive(duo)).toBe(1)
    })

    it('a group without parents keeps every homozygous variant', () => {
      const solo = service.analysisGroups.createGroup('SOLO', 'family').id
      service.analysisGroups.addMember(solo, probandId, 'proband', 'affected')
      expect(recessive(solo)).toBe(1)
    })
  })

  it('de_novo keeps a haploid proband call (male chrX)', () => {
    service.variants.insertVariantsBatch(probandId, [
      makeVariant({ chr: 'X', gt_num: '1', pos: 5000000 }),
      makeVariant({ chr: 'X', gt_num: '1', pos: 5000100 })
    ])
    service.variants.insertVariantsBatch(motherId, [
      makeVariant({ chr: 'X', gt_num: '0/1', pos: 5000100 })
    ])
    const result = service.variants.getVariants(
      { case_id: probandId, inheritance_modes: ['de_novo'], analysis_group_id: groupId },
      50,
      0
    )
    expect(result.data.map((v) => v.pos)).toEqual([5000000])
  })

  it.each([
    ['male', [5000000]],
    ['female', []],
    ['unknown', []]
  ])('de_novo for a proband of sex %s keeps a diploid chrX 1/1 at %j', (sex, expected) => {
    service.metadata.upsertCaseMetadata(probandId, { sex })
    service.variants.insertVariantsBatch(probandId, [
      makeVariant({ chr: 'X', gt_num: '1/1', pos: 5000000 }),
      makeVariant({ chr: 'X', gt_num: '1/1', pos: 5000100 }),
      makeVariant({ chr: '1', gt_num: '1/1', pos: 300 })
    ])
    service.variants.insertVariantsBatch(motherId, [
      makeVariant({ chr: 'X', gt_num: '0/1', pos: 5000100 })
    ])
    const result = service.variants.getVariants(
      { case_id: probandId, inheritance_modes: ['de_novo'], analysis_group_id: groupId },
      50,
      0
    )
    expect(result.data.map((v) => v.pos)).toEqual(expected)
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
