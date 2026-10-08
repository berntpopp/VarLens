import { describe, expect, it } from 'vitest'

import {
  buildGeneContingencyData,
  type AssociationVariantRow
} from '../../../src/main/statistics/contingency'
import { computeGeneAssociation } from '../../../src/main/statistics/gene-tests'
import { genotypeZygosity, REF_GENOTYPES } from '../../../src/shared/utils/genotype'

const SITE = '1:100:A:T'
const OTHER_SITE = '1:200:C:G'
const NONE = { missing_call: 0, conflicting_calls: 0, no_called_alleles: 0 }

/** What gtDosageSql returns: 2 hom, 1 het or haploid, 0 reference, NULL for anything else. */
function sqlDosage(gt: string | null): number | null {
  const zygosity = genotypeZygosity(gt)
  if (zygosity !== null) return zygosity === 'hom' ? 2 : 1
  return gt !== null && (REF_GENOTYPES as readonly string[]).includes(gt) ? 0 : null
}

/** A stored row as both builders read it. */
const row = (case_id: number, gt_num: string | null, variant_key = SITE): AssociationVariantRow => ({
  gene_symbol: 'GENE1',
  case_id,
  variant_key,
  gt_num,
  dosage: sqlDosage(gt_num),
  gnomad_af: null,
  cadd: null
})

const build = (rows: AssociationVariantRow[], groupA: number[], groupB: number[]) =>
  buildGeneContingencyData(rows, groupA, groupB, new Map())[0]

const frequency = (rows: AssociationVariantRow[], groupA: number[], groupB: number[]): number =>
  build(rows, groupA, groupB).samples[0].variant_mafs[0]

describe('burden allele frequency counts called alleles (#517)', () => {
  it('a haploid ALT call is one allele of one: frequency 1', () => {
    expect(frequency([row(1, '1')], [1], [])).toBe(1)
  })

  it('a sample without a row is read as diploid reference', () => {
    // 1 ALT of 1 (haploid) + 2 (absent) alleles.
    expect(frequency([row(1, '1')], [1], [2])).toBeCloseTo(1 / 3)
  })

  it('an assumed het (1/.) is a diploid het', () => {
    expect(frequency([row(1, '1/.')], [1], [])).toBe(0.5)
  })

  it('a reference half-call (0/.) is two called alleles with no copy of this ALT', () => {
    expect(frequency([row(1, '0/.'), row(2, '0/1')], [1], [2])).toBe(1 / 4)
    expect(frequency([row(1, './0'), row(2, '0|1')], [1], [2])).toBe(1 / 4)
    expect(frequency([row(1, '1/.'), row(2, '0/0')], [1], [2])).toBe(1 / 4)
  })
})

describe('the shipped genotype classes stay (#520)', () => {
  it.each(['1/.', './1', '1|.', '.|1'])('an assumed het %s is dosage 1 and keeps its site', (gt) => {
    const gene = build([row(1, gt), row(2, '0/1')], [1], [2])
    expect(gene.sites_excluded).toEqual(NONE)
    expect(gene.samples.map((s) => s.dosages)).toEqual([[1], [1]])
    expect(gene).toMatchObject({ groupA_carrier_count: 1, groupB_carrier_count: 1 })
  })

  it.each(['0/.', './0', '0|.', '.|0'])('a reference half-call %s is dosage 0 and keeps its site', (gt) => {
    const gene = build([row(1, gt), row(2, '0/1')], [1], [2])
    expect(gene.sites_excluded).toEqual(NONE)
    expect(gene.samples.map((s) => s.dosages)).toEqual([[0], [1]])
  })

  it.each(['./.', '.|.', '.', null, 'not-a-genotype'])('an unknown call %j excludes its site', (gt) => {
    const gene = build([row(1, gt), row(2, '0/1')], [1], [2])
    expect(gene.sites_excluded).toEqual({ ...NONE, missing_call: 1 })
    expect(gene.samples.map((s) => s.dosages)).toEqual([[], []])
    expect(gene.groupB_carrier_count).toBe(0)
  })
})

describe('complete-site rule (#520)', () => {
  // SITE: case 1 het, plus one unknown call. OTHER_SITE: cases 2 and 4 het.
  const complete = [row(2, '0/1', OTHER_SITE), row(4, '0/1', OTHER_SITE)]

  for (const gt of ['./.', null]) {
    for (const [group, unknownCase] of [
      ['group A', 2],
      ['group B', 3]
    ] as const) {
      it(`an unknown call ${JSON.stringify(gt)} in ${group} excludes the site from burden and Fisher`, () => {
        const gene = build([row(1, '0/1'), row(unknownCase, gt), ...complete], [1, 2], [3, 4])

        expect(gene.sites_excluded).toEqual({ ...NONE, missing_call: 1 })
        // One site is left (OTHER_SITE); case 1's het at SITE is counted for nobody.
        expect(gene.samples.map((s) => s.dosages)).toEqual([[0], [1], [0], [1]])
        expect(gene.samples[0].variant_mafs).toEqual([2 / 8])
        expect(gene).toMatchObject({
          groupA_carrier_count: 1,
          groupA_non_carrier_count: 1,
          groupB_carrier_count: 1,
          groupB_non_carrier_count: 1
        })
      })
    }
  }

  it('swapping the group labels excludes the same sites', () => {
    const rows = [row(1, '0/1'), row(3, './.'), ...complete]
    const ab = build(rows, [1, 2], [3, 4])
    const ba = build(rows, [3, 4], [1, 2])

    expect(ba.sites_excluded).toEqual(ab.sites_excluded)
    expect(ba.samples[0].variant_mafs).toEqual(ab.samples[0].variant_mafs)
    expect(ba.groupA_carrier_count).toBe(ab.groupB_carrier_count)
    expect(ba.groupB_carrier_count).toBe(ab.groupA_carrier_count)
  })

  it('a site no tested sample calls is excluded: no_called_alleles', () => {
    // Neither sample has its covariate, so nobody is left to compute a frequency from.
    const covariates = new Map([
      [1, [NaN]],
      [2, [NaN]]
    ])
    const [gene] = buildGeneContingencyData([row(1, '0/1')], [1], [2], covariates)
    expect(gene.sites_excluded).toEqual({ ...NONE, no_called_alleles: 1 })
    expect(gene.samples.map((s) => s.dosages)).toEqual([[], []])
  })

  it('a gene whose every site is excluded is reported, not tested', () => {
    const gene = build([row(1, './.')], [1], [2])
    expect(gene.sites_excluded).toEqual({ ...NONE, missing_call: 1 })
    expect(gene.samples.map((s) => s.dosages)).toEqual([[], []])

    const result = computeGeneAssociation(gene, 'beta_maf')
    expect(result).toMatchObject({
      n_variants: 0,
      sites_excluded: { ...NONE, missing_call: 1 },
      groupA_carriers: 0,
      groupA_total: 1,
      groupB_total: 1
    })
    // No p-value: the gene must not enter the FDR correction with p = 1.
    expect(result.fisher.p_value).toBeNull()
    expect(result.logistic_burden.p_value).toBeNull()
  })
})

describe('duplicate rows of one case (#516, #520)', () => {
  it.each([
    [['0/1', '1/1']],
    [['1/.', '1/1']],
    [['./1', '0/.']],
    [['1', '0/0']],
    [['0/1', './.']],
    [['1/1', null]]
  ])('%j disagree in dosage: the call is missing, in either row order', (gts) => {
    for (const order of [gts, [...gts].reverse()]) {
      const gene = build(
        order.map((gt) => row(1, gt)),
        [1],
        []
      )
      expect(gene.sites_excluded).toEqual({ ...NONE, conflicting_calls: 1 })
      expect(gene.samples[0].dosages).toEqual([])
    }
  })

  it.each([
    [['0/1', '0|1'], 1],
    [['1/1', '1|1'], 2],
    [['0/1', '1/.'], 1],
    [['0/0', '0|0'], 0],
    [['0/0', '0/.'], 0]
  ])('%j agree: dosage %i, in either row order', (gts, dosage) => {
    for (const order of [gts, [...gts].reverse()]) {
      const gene = build(
        order.map((gt) => row(1, gt)),
        [1],
        []
      )
      expect(gene.sites_excluded).toEqual(NONE)
      expect(gene.samples[0].dosages).toEqual([dosage])
    }
  })

  it('two unknown rows are one missing call, not a conflict', () => {
    expect(build([row(1, './.'), row(1, null)], [1], []).sites_excluded).toEqual({
      ...NONE,
      missing_call: 1
    })
  })

  it('a conflict outranks a missing call at one site, whatever the sample order', () => {
    const rows = [row(1, './.'), row(2, '0/1'), row(2, '1/1')]
    const expected = { ...NONE, conflicting_calls: 1 }
    expect(build(rows, [1], [2]).sites_excluded).toEqual(expected)
    expect(build(rows, [2], [1]).sites_excluded).toEqual(expected)
  })
})
