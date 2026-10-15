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

  // Issue #553: a trio mode that cannot be evaluated must never fall back to unfiltered.
  describe('trio modes without an analysis group', () => {
    beforeEach(() => {
      service.variants.insertVariantsBatch(probandId, [
        makeVariant({ gt_num: '0/1', pos: 100 }),
        makeVariant({ gt_num: '1/1', pos: 200 })
      ])
    })
    const positions = (modes: string[], group?: number): number[] =>
      service.variants
        .getVariants(
          { case_id: probandId, inheritance_modes: modes, analysis_group_id: group },
          50,
          0
        )
        .data.map((v) => v.pos)

    it.each([
      'de_novo',
      'autosomal_recessive',
      'compound_het',
      'autosomal_dominant',
      'x_recessive',
      'x_dominant'
    ])('%s alone matches no row', (mode) => {
      expect(positions([mode])).toEqual([])
    })

    it('mixed with a solo mode keeps only the solo rows', () => {
      expect(positions(['homozygous', 'de_novo'])).toEqual([200])
    })
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

    it('a parent with a reference and an uncalled row is reference: the resolved call decides', () => {
      service.variants.insertVariantsBatch(fatherId, [makeVariant({ gt_num: '0/1', pos: 100 })])
      service.variants.insertVariantsBatch(motherId, [
        makeVariant({ gt_num: './.', pos: 100 }),
        makeVariant({ gt_num: '0/0', pos: 100, transcript: 'NM_OTHER.1' })
      ])
      expect(recessive()).toBe(0)
    })

    it('a parent with a het and a reference row is a het carrier', () => {
      service.variants.insertVariantsBatch(fatherId, [makeVariant({ gt_num: '0/1', pos: 100 })])
      service.variants.insertVariantsBatch(motherId, [
        makeVariant({ gt_num: '0/0', pos: 100 }),
        makeVariant({ gt_num: '1|0', pos: 100, transcript: 'NM_OTHER.1' })
      ])
      expect(recessive()).toBe(1)
    })

    it('fails when a parent has a haploid call', () => {
      service.variants.insertVariantsBatch(fatherId, [makeVariant({ gt_num: '1', pos: 100 })])
      service.variants.insertVariantsBatch(motherId, [makeVariant({ gt_num: '0/1', pos: 100 })])
      expect(recessive()).toBe(0)
    })

    it.each(['X', 'chrX', 'Y', 'chrY', 'MT', 'chrM'])(
      'leaves out a homozygous call on %s: the mode is autosomal',
      (chr) => {
        const solo = service.analysisGroups.createGroup('SOLO', 'family').id
        service.analysisGroups.addMember(solo, probandId, 'proband', 'affected')
        service.variants.insertVariantsBatch(probandId, [
          makeVariant({ gt_num: '1/1', chr, pos: 500 })
        ])
        expect(recessive(solo)).toBe(1) // the chr 1 variant only
      }
    )

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

  describe('de_novo quality thresholds (#626)', () => {
    it('filters proband variants by min GQ, min DP, and min AB while allowing NULLs', () => {
      service.variants.insertVariantsBatch(probandId, [
        makeVariant({ gt_num: '0/1', pos: 100, gq: 30, dp: 20, ab: 0.45 }), // passes all
        makeVariant({ gt_num: '0/1', pos: 200, gq: 15, dp: 20, ab: 0.45 }), // fails min GQ
        makeVariant({ gt_num: '0/1', pos: 300, gq: 30, dp: 5, ab: 0.45 }), // fails min DP
        makeVariant({ gt_num: '0/1', pos: 400, gq: 30, dp: 20, ab: 0.1 }), // fails min AB
        makeVariant({ gt_num: '0/1', pos: 500, gq: null, dp: null, ab: null }) // NULL passes all
      ])

      const result = service.variants.getVariants(
        {
          case_id: probandId,
          inheritance_modes: ['de_novo'],
          analysis_group_id: groupId,
          de_novo_min_gq: 20,
          de_novo_min_dp: 10,
          de_novo_min_ab: 0.2
        },
        50,
        0
      )
      expect(result.data.map((v) => v.pos).sort((a, b) => a - b)).toEqual([100, 500])
    })

    it('withholds variant when stored reference parent row fails min GQ, min DP, or max parent AB', () => {
      service.variants.insertVariantsBatch(probandId, [
        makeVariant({ gt_num: '0/1', pos: 100, gq: 40, dp: 30, ab: 0.5 }), // father ref passes quality
        makeVariant({ gt_num: '0/1', pos: 200, gq: 40, dp: 30, ab: 0.5 }), // father ref fails GQ
        makeVariant({ gt_num: '0/1', pos: 300, gq: 40, dp: 30, ab: 0.5 }), // mother ref fails DP
        makeVariant({ gt_num: '0/1', pos: 400, gq: 40, dp: 30, ab: 0.5 }), // mother ref fails max parent AB
        makeVariant({ gt_num: '0/1', pos: 500, gq: 40, dp: 30, ab: 0.5 }) // parent ref with NULL quality passes
      ])
      service.variants.insertVariantsBatch(fatherId, [
        makeVariant({ gt_num: '0/0', pos: 100, gq: 30, dp: 20, ab: 0.0 }),
        makeVariant({ gt_num: '0/0', pos: 200, gq: 10, dp: 20, ab: 0.0 }),
        makeVariant({ gt_num: '0/0', pos: 500, gq: null, dp: null, ab: null })
      ])
      service.variants.insertVariantsBatch(motherId, [
        makeVariant({ gt_num: '0/0', pos: 300, gq: 30, dp: 8, ab: 0.0 }),
        makeVariant({ gt_num: '0/0', pos: 400, gq: 30, dp: 20, ab: 0.05 })
      ])

      const result = service.variants.getVariants(
        {
          case_id: probandId,
          inheritance_modes: ['de_novo'],
          analysis_group_id: groupId,
          de_novo_min_gq: 20,
          de_novo_min_dp: 10,
          de_novo_max_parent_ab: 0.02
        },
        50,
        0
      )
      expect(result.data.map((v) => v.pos).sort((a, b) => a - b)).toEqual([100, 500])
    })
  })

  describe('autosomal_dominant (#627)', () => {
    it('requires at least one other affected group member and segregates with affected status', () => {
      const adGroup = service.analysisGroups.createGroup('AD_FAM', 'family').id
      const siblingId = service.cases.createCase('sibling', '/s.json', 100)
      service.analysisGroups.addMember(adGroup, probandId, 'proband', 'affected')
      service.analysisGroups.addMember(adGroup, fatherId, 'father', 'affected')
      service.analysisGroups.addMember(adGroup, motherId, 'mother', 'unaffected')
      service.analysisGroups.addMember(adGroup, siblingId, 'sibling', 'unaffected')

      service.variants.insertVariantsBatch(probandId, [
        makeVariant({ chr: '1', gt_num: '0/1', pos: 100 }), // father affected carries, mother/sib absent -> keep
        makeVariant({ chr: '1', gt_num: '0/1', pos: 200 }), // father affected absent -> exclude
        makeVariant({ chr: '1', gt_num: '0/1', pos: 300 }), // father carries, unaffected mother also carries -> exclude
        makeVariant({ chr: '1', gt_num: '1/1', pos: 400 }), // proband hom -> exclude
        makeVariant({ chr: 'X', gt_num: '0/1', pos: 500 }) // non-autosomal -> exclude
      ])
      service.variants.insertVariantsBatch(fatherId, [
        makeVariant({ chr: '1', gt_num: '0/1', pos: 100 }),
        makeVariant({ chr: '1', gt_num: '0/1', pos: 300 }),
        makeVariant({ chr: '1', gt_num: '0/1', pos: 400 }),
        makeVariant({ chr: 'X', gt_num: '0/1', pos: 500 })
      ])
      service.variants.insertVariantsBatch(motherId, [
        makeVariant({ chr: '1', gt_num: '0/0', pos: 100 }),
        makeVariant({ chr: '1', gt_num: '0/1', pos: 300 })
      ])
      service.variants.insertVariantsBatch(siblingId, [
        makeVariant({ chr: '1', gt_num: './.', pos: 100 }) // uncalled unaffected relative does not exclude
      ])

      const result = service.variants.getVariants(
        {
          case_id: probandId,
          inheritance_modes: ['autosomal_dominant'],
          analysis_group_id: adGroup
        },
        50,
        0
      )
      expect(result.data.map((v) => v.pos)).toEqual([100])
    })

    it('matches no row when no other affected group member exists', () => {
      // Standard trio in groupId has father and mother both unaffected
      service.variants.insertVariantsBatch(probandId, [
        makeVariant({ chr: '1', gt_num: '0/1', pos: 100 })
      ])
      const result = service.variants.getVariants(
        {
          case_id: probandId,
          inheritance_modes: ['autosomal_dominant'],
          analysis_group_id: groupId
        },
        50,
        0
      )
      expect(result.data).toHaveLength(0)
    })
  })

  describe('x_recessive (#627)', () => {
    it('keeps non-PAR chrX male hemizygous variant with carrier mother and reference unaffected father', () => {
      service.metadata.upsertCaseMetadata(probandId, { sex: 'male' })
      service.variants.insertVariantsBatch(probandId, [
        makeVariant({ chr: 'X', gt_num: '1', pos: 5_000_000 }), // haploid male hemi -> keep
        makeVariant({ chr: 'chrX', gt_num: '1/1', pos: 6_000_000 }), // diploid-called male hemi -> keep
        makeVariant({ chr: 'X', gt_num: '0/1', pos: 7_000_000 }), // het -> exclude
        makeVariant({ chr: 'X', gt_num: '1', pos: 8_000_000 }), // mother absent (ref) -> exclude
        makeVariant({ chr: 'X', gt_num: '1', pos: 9_000_000 }) // unaffected father carries -> exclude
      ])
      service.variants.insertVariantsBatch(motherId, [
        makeVariant({ chr: 'X', gt_num: '0/1', pos: 5_000_000 }),
        makeVariant({ chr: 'chrX', gt_num: '0/1', pos: 6_000_000 }),
        makeVariant({ chr: 'X', gt_num: '0/1', pos: 7_000_000 }),
        makeVariant({ chr: 'X', gt_num: '0/1', pos: 9_000_000 })
      ])
      service.variants.insertVariantsBatch(fatherId, [
        makeVariant({ chr: 'X', gt_num: '0/0', pos: 5_000_000 }),
        makeVariant({ chr: 'X', gt_num: '1', pos: 9_000_000 })
      ])

      const result = service.variants.getVariants(
        {
          case_id: probandId,
          inheritance_modes: ['x_recessive'],
          analysis_group_id: groupId
        },
        50,
        0
      )
      expect(result.data.map((v) => v.pos).sort((a, b) => a - b)).toEqual([5_000_000, 6_000_000])
    })

    it('keeps non-PAR chrX female homozygous variant with carrier mother', () => {
      service.metadata.upsertCaseMetadata(probandId, { sex: 'female' })
      service.variants.insertVariantsBatch(probandId, [
        makeVariant({ chr: 'X', gt_num: '1/1', pos: 5_000_000 }),
        makeVariant({ chr: 'X', gt_num: '0/1', pos: 6_000_000 })
      ])
      service.variants.insertVariantsBatch(motherId, [
        makeVariant({ chr: 'X', gt_num: '0/1', pos: 5_000_000 }),
        makeVariant({ chr: 'X', gt_num: '0/1', pos: 6_000_000 })
      ])

      const result = service.variants.getVariants(
        {
          case_id: probandId,
          inheritance_modes: ['x_recessive'],
          analysis_group_id: groupId
        },
        50,
        0
      )
      expect(result.data.map((v) => v.pos)).toEqual([5_000_000])
    })

    it('excludes PAR1 and PAR2 coordinates according to case genome_build (GRCh38 vs GRCh37)', () => {
      // Position 50,000 is inside GRCh38 PAR1 (10,001..2,781,479) but outside GRCh37 PAR1 (60,001..2,699,520)
      // Position 100,000 is inside PAR1 on both builds
      // Position 155,000,000 is inside GRCh37 PAR2 (154,931,044..155,260,560) but outside GRCh38 PAR2 (155,701,383..156,030,895)
      // Position 155,800,000 is inside GRCh38 PAR2 but outside GRCh37 PAR2
      const positions = [50_000, 100_000, 5_000_000, 155_000_000, 155_800_000]
      service.variants.insertVariantsBatch(
        probandId,
        positions.map((pos) => makeVariant({ chr: 'X', gt_num: '1', pos }))
      )
      service.variants.insertVariantsBatch(
        motherId,
        positions.map((pos) => makeVariant({ chr: 'X', gt_num: '0/1', pos }))
      )

      // Default case build is GRCh38
      const grch38Result = service.variants.getVariants(
        {
          case_id: probandId,
          inheritance_modes: ['x_recessive'],
          analysis_group_id: groupId
        },
        50,
        0
      )
      expect(grch38Result.data.map((v) => v.pos).sort((a, b) => a - b)).toEqual([
        5_000_000, 155_000_000
      ])

      // Switch proband case to GRCh37
      service.database
        .prepare('UPDATE cases SET genome_build = ? WHERE id = ?')
        .run('GRCh37', probandId)
      const grch37Result = service.variants.getVariants(
        {
          case_id: probandId,
          inheritance_modes: ['x_recessive'],
          analysis_group_id: groupId
        },
        50,
        0
      )
      expect(grch37Result.data.map((v) => v.pos).sort((a, b) => a - b)).toEqual([
        50_000, 5_000_000, 155_800_000
      ])
    })
  })

  describe('x_dominant (#627)', () => {
    it('keeps non-PAR chrX het or male hemizygous variant segregating with affected status', () => {
      const xldGroup = service.analysisGroups.createGroup('XLD_FAM', 'family').id
      service.analysisGroups.addMember(xldGroup, probandId, 'proband', 'affected')
      service.analysisGroups.addMember(xldGroup, motherId, 'mother', 'affected')
      service.analysisGroups.addMember(xldGroup, fatherId, 'father', 'unaffected')
      service.metadata.upsertCaseMetadata(probandId, { sex: 'male' })

      service.variants.insertVariantsBatch(probandId, [
        makeVariant({ chr: 'X', gt_num: '0/1', pos: 5_000_000 }), // het, affected mother carries -> keep
        makeVariant({ chr: 'X', gt_num: '1', pos: 6_000_000 }), // male hemi, affected mother carries -> keep
        makeVariant({ chr: 'X', gt_num: '1/1', pos: 7_000_000 }), // male diploid hemi, affected mother carries -> keep
        makeVariant({ chr: 'X', gt_num: '0/1', pos: 8_000_000 }), // affected mother absent -> exclude
        makeVariant({ chr: 'X', gt_num: '0/1', pos: 9_000_000 }), // unaffected father carries -> exclude
        makeVariant({ chr: 'X', gt_num: '0/1', pos: 100_000 }), // PAR1 -> exclude
        makeVariant({ chr: '1', gt_num: '0/1', pos: 5_000_000 }) // autosomal -> exclude
      ])
      service.variants.insertVariantsBatch(motherId, [
        makeVariant({ chr: 'X', gt_num: '0/1', pos: 5_000_000 }),
        makeVariant({ chr: 'X', gt_num: '0/1', pos: 6_000_000 }),
        makeVariant({ chr: 'X', gt_num: '0/1', pos: 7_000_000 }),
        makeVariant({ chr: 'X', gt_num: '0/1', pos: 9_000_000 }),
        makeVariant({ chr: 'X', gt_num: '0/1', pos: 100_000 }),
        makeVariant({ chr: '1', gt_num: '0/1', pos: 5_000_000 })
      ])
      service.variants.insertVariantsBatch(fatherId, [
        makeVariant({ chr: 'X', gt_num: '1', pos: 9_000_000 })
      ])

      const result = service.variants.getVariants(
        {
          case_id: probandId,
          inheritance_modes: ['x_dominant'],
          analysis_group_id: xldGroup
        },
        50,
        0
      )
      expect(result.data.map((v) => v.pos).sort((a, b) => a - b)).toEqual([
        5_000_000, 6_000_000, 7_000_000
      ])
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
