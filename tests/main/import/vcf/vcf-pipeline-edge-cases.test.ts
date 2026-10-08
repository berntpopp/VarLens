/**
 * Inline VCF text through the chain both import workers run:
 * header parser → line parser → mapper (#495).
 */
import { describe, it, expect } from 'vitest'
import { DEFAULT_INFO_FIELD_MAPPINGS } from '../../../../src/main/import/vcf/info-field-registry'
import type { VcfMappedVariant } from '../../../../src/main/import/vcf/types'
import { parseVcfHeaderFromLines } from '../../../../src/main/import/vcf/vcf-header-parser'
import { parseVcfLine } from '../../../../src/main/import/vcf/vcf-line-parser'
import { mapVcfRecord } from '../../../../src/main/import/vcf/VcfMapper'

const COLUMNS = '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tS1'

/** `row`: space-separated columns CHROM..S1 of one data line. */
function mapRow(headerLines: string[], row: string): VcfMappedVariant[] {
  const header = parseVcfHeaderFromLines(['##fileformat=VCFv4.2', ...headerLines, COLUMNS])
  const record = parseVcfLine(row.split(' ').join('\t'), header.samples)
  if (record === null) throw new Error('line rejected')
  return mapVcfRecord(record, header, 'S1', DEFAULT_INFO_FIELD_MAPPINGS)
}

describe('VCF pipeline edge cases', () => {
  it('does not import the spanning-deletion allele (*) as a variant', () => {
    const mapped = mapRow([], 'chr1 100 . A *,T 50 PASS . GT 1/2')
    expect(mapped.map((v) => v.alt)).toEqual(['T'])
  })

  it('annotates an SNV next to an insertion whose trimmed spelling collides with it', () => {
    const csq =
      '##INFO=<ID=CSQ,Number=.,Type=String,Description="Consequence annotations from Ensembl VEP. Format: Allele|Consequence|IMPACT|SYMBOL">'
    const mapped = mapRow(
      [csq],
      'chr1 100 . G A,GA 50 PASS CSQ=A|missense_variant|MODERATE|GENE1,GA|frameshift_variant|HIGH|GENE1 GT 1/2'
    )
    expect(mapped.map((v) => [v.alt, v.func, v.consequence])).toEqual([
      ['A', 'missense_variant', 'MODERATE'],
      ['GA', 'frameshift_variant', 'HIGH']
    ])
  })

  it('reads allele depths when the header declares AD as Number=. (older GATK)', () => {
    const ad = '##FORMAT=<ID=AD,Number=.,Type=Integer,Description="Allelic depths">'
    const mapped = mapRow([ad], 'chr1 100 . A T,G 50 PASS . GT:AD 1/2:2,10,30')
    expect(mapped.map((v) => [v.alt, v.ad_ref, v.ad_alt, v.ab])).toEqual([
      ['T', 2, 10, 10 / 12],
      ['G', 2, 30, 30 / 32]
    ])
    // Not one value per allele: no way to tell which depth belongs to which.
    const unclear = mapRow([ad], 'chr1 100 . A T,G 50 PASS . GT:AD 1/2:2,10')
    expect(unclear.map((v) => [v.ad_ref, v.ad_alt, v.ab])).toEqual([
      [null, null, null],
      [null, null, null]
    ])
  })

  it('gives each allele its own value of a per-allele INFO field the header does not declare', () => {
    const afs = (info: string): Array<number | null> =>
      mapRow([], `chr1 100 . A T,G 50 PASS ${info} GT 1/2`).map((v) => v.gnomad_af)
    expect(afs('gnomAD_AF=0.5,0.0001')).toEqual([0.5, 0.0001])
    // Not one value per ALT: a wrong frequency is worse than none.
    expect(afs('gnomAD_AF=0.5,0.0001,0.2')).toEqual([null, null])
  })
})
