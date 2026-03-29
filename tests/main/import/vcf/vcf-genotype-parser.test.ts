import { describe, it, expect } from 'vitest'
import { parseGenotype } from '../../../../src/main/import/vcf/vcf-genotype-parser'

describe('vcf-genotype-parser', () => {
  const FORMAT = ['GT', 'GQ', 'DP', 'AD']

  it('parses a heterozygous genotype', () => {
    const gt = parseGenotype(['0/1', '99', '45', '22,23'], FORMAT)

    expect(gt.gt).toBe('0/1')
    expect(gt.gq).toBe(99)
    expect(gt.dp).toBe(45)
    expect(gt.adRef).toBe(22)
    expect(gt.adAlt).toBe(23)
    expect(gt.ab).toBeCloseTo(23 / 45, 4)
  })

  it('parses a homozygous alt genotype', () => {
    const gt = parseGenotype(['1/1', '78', '30', '0,30'], FORMAT)

    expect(gt.gt).toBe('1/1')
    expect(gt.adRef).toBe(0)
    expect(gt.adAlt).toBe(30)
    expect(gt.ab).toBe(1.0)
  })

  it('parses a homozygous ref genotype', () => {
    const gt = parseGenotype(['0/0', '99', '40', '40,0'], FORMAT)

    expect(gt.gt).toBe('0/0')
    expect(gt.adRef).toBe(40)
    expect(gt.adAlt).toBe(0)
    expect(gt.ab).toBe(0)
  })

  it('handles missing genotype (./.)', () => {
    const gt = parseGenotype(['./.', '.', '.', '.'], FORMAT)

    expect(gt.gt).toBe('./.')
    expect(gt.gq).toBeNull()
    expect(gt.dp).toBeNull()
    expect(gt.adRef).toBeNull()
    expect(gt.adAlt).toBeNull()
    expect(gt.ab).toBeNull()
  })

  it('handles partial missing values (.:.:.:.) ', () => {
    const gt = parseGenotype(['.', '.', '.', '.'], FORMAT)

    expect(gt.gt).toBe('.')
    expect(gt.gq).toBeNull()
    expect(gt.dp).toBeNull()
    expect(gt.adRef).toBeNull()
    expect(gt.adAlt).toBeNull()
    expect(gt.ab).toBeNull()
  })

  it('handles hemizygous genotype (chrX male)', () => {
    const gt = parseGenotype(['1', '88', '30', '0,30'], FORMAT)

    expect(gt.gt).toBe('1')
    expect(gt.gq).toBe(88)
    expect(gt.dp).toBe(30)
    expect(gt.adRef).toBe(0)
    expect(gt.adAlt).toBe(30)
  })

  it('handles phased genotype', () => {
    const gt = parseGenotype(['0|1', '85', '42', '20,22'], FORMAT)

    expect(gt.gt).toBe('0|1')
    expect(gt.gq).toBe(85)
  })

  it('handles multi-allelic AD (takes first two by default)', () => {
    const gt = parseGenotype(['0/1', '95', '50', '25,25,0'], FORMAT)

    expect(gt.adRef).toBe(25)
    expect(gt.adAlt).toBe(25)
    expect(gt.ab).toBeCloseTo(0.5, 4)
  })

  it('handles FORMAT with only GT', () => {
    const gt = parseGenotype(['0/1'], ['GT'])

    expect(gt.gt).toBe('0/1')
    expect(gt.gq).toBeNull()
    expect(gt.dp).toBeNull()
    expect(gt.adRef).toBeNull()
    expect(gt.adAlt).toBeNull()
    expect(gt.ab).toBeNull()
  })

  it('handles FORMAT fields in non-standard order', () => {
    const gt = parseGenotype(['40', '0/1', '22,18', '92'], ['DP', 'GT', 'AD', 'GQ'])

    expect(gt.gt).toBe('0/1')
    expect(gt.dp).toBe(40)
    expect(gt.gq).toBe(92)
    expect(gt.adRef).toBe(22)
    expect(gt.adAlt).toBe(18)
  })

  it('computes AB as null when both AD values are 0', () => {
    const gt = parseGenotype(['0/0', '99', '0', '0,0'], FORMAT)

    expect(gt.ab).toBeNull()
  })

  it('specifies alt allele index for multi-allelic AD', () => {
    // AD = ref, alt1, alt2 — we want alt2 (index 2)
    const gt = parseGenotype(['0/2', '90', '48', '24,0,24'], FORMAT, 2)

    expect(gt.adRef).toBe(24)
    expect(gt.adAlt).toBe(24)
    expect(gt.ab).toBeCloseTo(0.5, 4)
  })
})
