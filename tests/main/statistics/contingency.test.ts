import { describe, expect, it } from 'vitest'

import {
  buildGeneContingencyData,
  type AssociationVariantRow
} from '../../../src/main/statistics/contingency'
import { gtToDosage } from '../../../src/shared/utils/genotype'

const row = (case_id: number, gt_num: string | null): AssociationVariantRow => ({
  gene_symbol: 'GENE1',
  case_id,
  variant_key: 'X:100:A:T',
  gt_num,
  dosage: gtToDosage(gt_num) ?? 0,
  gnomad_af: null,
  cadd: null
})

function frequency(rows: AssociationVariantRow[], groupA: number[], groupB: number[]): number {
  const [gene] = buildGeneContingencyData(rows, groupA, groupB, new Map())
  return gene.samples[0].variant_mafs[0]
}

describe('burden allele frequency counts called alleles (#517)', () => {
  it('a haploid ALT call is one allele of one: frequency 1', () => {
    expect(frequency([row(1, '1')], [1], [])).toBe(1)
  })

  it('a sample without a row is read as diploid reference', () => {
    // 1 ALT of 1 (haploid) + 2 (absent) alleles.
    expect(frequency([row(1, '1')], [1], [2])).toBeCloseTo(1 / 3)
  })

  it('a missing call is not in the denominator', () => {
    expect(frequency([row(1, '0/1'), row(2, './.'), row(3, null)], [1, 2], [3])).toBe(0.5)
  })

  it('an assumed het (1/.) is a diploid het', () => {
    expect(frequency([row(1, '1/.')], [1], [])).toBe(0.5)
  })

  it('no called allele at all does not divide by zero', () => {
    expect(frequency([row(1, './.')], [1], [])).toBe(1e-8)
  })
})

describe('conflicting duplicate calls of one case (#516)', () => {
  it.each([
    [['./1', '0/.'], 1],
    [['0/1', '1/1'], 2],
    [['1', '0/0'], 1]
  ])('%j resolves to dosage %i in either row order', (gts, dosage) => {
    for (const order of [gts, [...gts].reverse()]) {
      const [gene] = buildGeneContingencyData(
        order.map((gt) => row(1, gt)),
        [1],
        [],
        new Map()
      )
      expect(gene.samples[0].dosages).toEqual([dosage])
    }
  })
})
